import { expect, mock, test } from "bun:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pageData } from "../../src/lib/data";
import { readPublication, publicationScope } from "../../../web/lib/workers-host/publication-fence";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { startFixture } from "../../scripts/fixture";
import { repositoryFixtures } from "./fixture";
// Match the production Vite transport and plain-anchor aliases without mutating global fetch.
const transport = new URL("../../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "published-reader-test", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });
// Mirror Vite react deduplication for shared web components in this isolated test file.
const { createElement } = React;
mock.module(new URL("../../../web/node_modules/react/index.js", import.meta.url).pathname, () => React);
mock.module("next/link", () => import("../../src/components/Link"));
const { RepoPageView } = await import("../../src/packages/p2/repo");
const { getRepoPageEntityDaily } = await import("../../../web/lib/data/entity");
const { getRepoCurve } = await import("../../../web/lib/data/compare");
const { GET } = await import("../../../web/app/repo-curve/route");
const { loadRepository, repositoryCurve, repositoryMetadata } = await import("../../src/packages/p2/data");
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";
import { secureResponse } from "../../src/lib/host";

test("P2 native reads match existing entity normalization and exact curve response bytes", async () => {
  const records = repositoryFixtures();
  const fixture = startFixture(records);
  const bucket = { async get(key: string) { const body = records.get(key); return body === undefined ? null : { key, etag: key, size: body.length, text: async () => body }; } } as R2Bucket;
  const publication = await readPublication(async (key) => records.has(key) ? { body: records.get(key)!, etag: key } : null);
  const data = pageData(bucket, publication);
  const old = <T>(run: () => T) => withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: fixture.url.origin, VIEWS_VERSION_FALLBACK: "" }, () => publicationScope.run(publication, run));
  try {
    for (const [id, name] of [[1, "repo"], [2, "history"], [3, "daily"]] as const) {
      const loaded = await loadRepository(data, "en", "example", name);
      expect(loaded.kind).toBe("page");
      if (loaded.kind !== "page") throw new Error("Fixture repository missing");
      expect(await old(() => getRepoPageEntityDaily(id))).toEqual(loaded.page.repo);
      const curve = await repositoryCurve(data, id);
      expect(curve).toEqual(await old(() => getRepoCurve(id)));
      const expected = await old(() => GET(new Request(`http://127.0.0.1/repo-curve?id=${id}`)));
      expect(JSON.stringify(curve)).toBe(await expected.text());
      expect(secureResponse(Response.json(curve, { headers: expected.headers }), "GET", "BYPASS").headers.get("cache-control")).toBe("private, no-store");
    }
    expect(await loadRepository(data, "ja", "example", "old-repo")).toEqual({ kind: "redirect", location: "/ja/example/repo" });
    expect(await loadRepository(data, "en", "missing", "repo")).toEqual({ kind: "missing" });
    expect(await loadRepository(data, "en", "bad/owner", "repo")).toEqual({ kind: "missing" });
    records.set("views/fixture-v1/entity/repo/1.json", '{"id":2}');
    expect(await loadRepository(data, "en", "example", "repo")).toEqual({ kind: "missing" });
  } finally { await fixture.stop(true); }
});

test("the host keeps private HTML even if a renderer supplies a public cache header", () => {
  expect(secureResponse(new Response("<html></html>", { headers: { "Content-Type": "text/html", "Cache-Control": "public, max-age=600" } }), "GET", "MISS").headers.get("cache-control")).toBe("private, no-store");
});

for (const locale of ["en", "ja"] as const) {
  test(`${locale}: repository disclosure follows the capsule and cites the captured publication`, async () => {
    const records = repositoryFixtures();
    const bucket = { async get(key: string) { const body = records.get(key); return body === undefined ? null : { key, etag: key, size: body.length, text: async () => body }; } } as R2Bucket;
    const publication = await readPublication(async (key) => records.has(key) ? { body: records.get(key)!, etag: key } : null);
    for (const name of ["repo", "history", "daily"]) {
      const loaded = await loadRepository(pageData(bucket, publication), locale, "example", name);
      if (loaded.kind !== "page") throw new Error("Fixture repository missing");
      const page = loaded.page;
      const html = renderToStaticMarkup(createElement(RepoPageView, page));
      const disclosure = html.match(/<gsc-about-data\b[^>]*>([\s\S]*?)<\/gsc-about-data>/)?.[1];
      expect(disclosure).toBeDefined();
      expect(disclosure).toContain(page.t.aboutData.heading);
      const capsule = html.indexOf('data-testid="answer-capsule"');
      const position = html.indexOf("<gsc-about-data");
      expect(capsule).toBeGreaterThanOrEqual(0);
      expect(position).toBeGreaterThan(capsule);
      expect(html.indexOf(page.t.common.faqHeading, position)).toBeGreaterThan(position);
      expect(disclosure).toContain(`href="${locale === "en" ? "" : "/ja"}/about#history-curve"`);
      expect(disclosure).toContain(page.t.aboutData.methodHistoryCurve);
      expect(disclosure).toContain('dateTime="2026-07-17"');
      expect(disclosure).toContain('href="/releases/fixture-v1"');
      const citation = disclosure!.match(/<span[^>]*data-citation="true"[^>]*>([^<]*)<\/span>/)?.[1];
      const title = `${repositoryMetadata(page).title} · GitStarClub`;
      const escapedTitle = renderToStaticMarkup(createElement("span", null, title)).slice(6, -7);
      expect(citation).toContain(escapedTitle);
      expect(citation).toContain(`https://gitstarclub.com${locale === "en" ? "" : "/ja"}/example/${name}`);
      expect(citation).toContain("2026-07-17");
      expect(citation).toContain("fixture-v1");
      expect(disclosure).toContain(page.t.aboutData.coverageUnknown);
      if (name === "daily") {
        expect(disclosure).toContain(page.t.aboutData.dailyHistory.split("{start}")[0]);
        expect(disclosure).toContain(new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date("2026-05-30")));
      }
      const changed = renderToStaticMarkup(createElement(RepoPageView, {
        ...page, meta: { ...page.meta!, generated_at: "2025-01-02T00:00:00Z", active_repo_count: 9876 }, releaseId: "changed-release",
      })).match(/<gsc-about-data\b[^>]*>([\s\S]*?)<\/gsc-about-data>/)?.[1];
      expect(changed).toContain('dateTime="2025-01-02"');
      expect(changed).toContain('href="/releases/changed-release"');
      expect(changed).toContain("9,876");
      expect(changed).not.toContain("fixture-v1");
    }
  });
}
