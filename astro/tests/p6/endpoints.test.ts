import { expect, test } from "bun:test";
import { startFixture, fixtureRecords } from "../../scripts/fixture";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { getSearchIndex } from "../../../web/lib/data/search";
import { buildSearchIndexResponse } from "../../../web/lib/search-index-response";
import { localeSitemapRoute } from "../../../web/lib/sitemap-routes";
import { GET as manifest } from "../../src/pages/manifest.webmanifest";
import { GET as robots } from "../../src/pages/robots.txt";
import { SearchIndex } from "../../../web/lib/contracts";
import { LOCALES } from "../../../web/lib/i18n";
import { serializeRobots } from "../../src/packages/p6/robots";
import type { APIContext } from "astro";

// Direct Bun tests cover reused builders; compare-local checks the built Worker
// with the actual Vite transport alias and request locals.
const context = {} as APIContext;

test("P6 reused search builder preserves the existing published response", async () => {
  const records = fixtureRecords();
  const fixture = startFixture(records);
  try {
    await withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin }, async () => {
      const response = await buildSearchIndexResponse(getSearchIndex);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(SearchIndex.safeParse(body).success).toBe(true);
      expect(response.headers.get("cache-control")).toContain("s-maxage=");
      expect(body.count).toBe(JSON.parse(records.get("search/index.json")!).count);
    });
  } finally { await fixture.stop(true); }
});

test("P6 reused sitemap builder serves every language and omits unpublished ranking periods", async () => {
  const fixture = startFixture();
  try {
    await withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin }, async () => {
      const response = await localeSitemapRoute("en")();
      const xml = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
      expect(xml).toContain("https://gitstarclub.com/about");
      for (const locale of LOCALES) expect(xml).toContain(`hreflang="${locale === "zh" ? "zh-CN" : locale}"`);
      expect(xml).not.toContain("/rankings/2026/10</loc>");
      expect(xml).toContain("/rankings/2026/7</loc>");
    });
  } finally { await fixture.stop(true); }
}, 30_000);

test("P6 metadata endpoints preserve the existing manifest and preview crawl policy", async () => {
  const manifestResponse = await manifest(context);
  expect(manifestResponse.headers.get("content-type")).toBe("application/manifest+json");
  expect(await manifestResponse.json()).toMatchObject({ start_url: "/", display: "standalone", short_name: "GitStarClub" });
  expect(await (await robots(context)).text()).toBe("User-Agent: *\nDisallow: /\n\n");
  expect(serializeRobots({ rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }], host: "https://gitstarclub.com", sitemap: "https://gitstarclub.com/sitemap.xml" })).toBe("User-Agent: *\nAllow: /\nDisallow: /api/\n\nHost: https://gitstarclub.com\nSitemap: https://gitstarclub.com/sitemap.xml\n");
});

test("the Worker preserves endpoint cache headers while keeping HTML behind its publication fence", async () => {
  const { secureResponse } = await import("../../src/lib/host");
  const endpoint = secureResponse(Response.json({}, { headers: { "Cache-Control": "public, max-age=0, s-maxage=3600" } }), "GET", "MISS");
  expect(endpoint.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=3600");
  expect(secureResponse(endpoint, "GET", "BYPASS").headers.get("cache-control")).toBe("private, no-store");
  const html = secureResponse(new Response("<main />", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=999" } }), "GET", "MISS");
  expect(html.headers.get("cache-control")).toBe("private, no-store");
});

test("published native transport uses captured request data without changing global fetch", async () => {
  const { fetchWithTimeout, withPublishedReaders } = await import("../../src/lib/published-readers");
  const { pageData } = await import("../../src/lib/data");
  const { workerBindings } = await import("../../../web/lib/workers-host/runtime-env");
  const original = globalThis.fetch;
  const reads: string[] = [];
  const bucket = { async get(key: string) {
    reads.push(key);
    if (key === "missing.json") return null;
    return { text: async () => '{"fixture":true}', etag: "fixture" };
  } } as unknown as Parameters<typeof pageData>[0];
  const data = pageData(bucket, { id: "p6", views: null, bootstrap: null, live: null });
  await withPublishedReaders(data, async () => {
    const origin = workerBindings().BLOB_BASE_URL;
    expect(origin).toBe("https://p6.astro-data.invalid");
    const response = await fetchWithTimeout(`${origin}/views/v1/meta.json?v=v1`, { cache: "force-cache" });
    expect(await response.json()).toEqual({ fixture: true });
    const absent = await fetchWithTimeout(`${origin}/missing.json`);
    expect(absent.status).toBe(404);
    const head = await fetchWithTimeout(new Request(`${origin}/views/v1/meta.json`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    await expect(fetchWithTimeout(`${origin}/meta.json`, { method: "POST" })).rejects.toThrow("read-only");
  }, { cloudflareReadPolicy: true });
  expect(reads).toEqual(["views/v1/meta.json", "missing.json", "views/v1/meta.json"]);
  expect(globalThis.fetch).toBe(original);
});
