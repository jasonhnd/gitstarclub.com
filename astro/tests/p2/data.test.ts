import { expect, test } from "bun:test";
import { pageData } from "../../src/lib/data";
import { readPublication, publicationScope } from "../../../web/lib/workers-host/publication-fence";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { startFixture } from "../../scripts/fixture";
import { repositoryFixtures } from "./fixture";
// Match the single production Vite transport alias without mutating global fetch.
const transport = new URL("../../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "published-reader-test", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });
const { getRepoPageEntityDaily } = await import("../../../web/lib/data/entity");
const { getRepoCurve } = await import("../../../web/lib/data/compare");
const { GET } = await import("../../../web/app/repo-curve/route");
const { loadRepository, repositoryCurve } = await import("../../src/packages/p2/data");
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
