import { expect, test } from "bun:test";
import { startFixture, fixtureRecords } from "../../scripts/fixture";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { GET as search } from "../../src/pages/search-index";
import { GET as sitemap } from "../../src/pages/sitemap-en.xml";
import { GET as manifest } from "../../src/pages/manifest.webmanifest";
import { GET as robots } from "../../src/pages/robots.txt";
import { SearchIndex } from "../../../web/lib/contracts";
import { LOCALES } from "../../../web/lib/i18n";
import { serializeRobots } from "../../src/packages/p6/robots";
import type { APIContext } from "astro";

const context = {} as APIContext;

test("P6 search uses the existing published response and missing-index behavior", async () => {
  const records = fixtureRecords();
  const fixture = startFixture(records);
  try {
    await withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin }, async () => {
      const response = await search(context);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(SearchIndex.safeParse(body).success).toBe(true);
      expect(response.headers.get("cache-control")).toContain("s-maxage=");
      expect(body.count).toBe(JSON.parse(records.get("search/index.json")!).count);
    });
  } finally { await fixture.stop(true); }
});

test("P6 sitemap serves every language and omits unpublished ranking periods", async () => {
  const fixture = startFixture();
  try {
    await withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin }, async () => {
      const response = await sitemap(context);
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
