import { expect, test } from "bun:test";
import { pageData } from "../src/lib/data";
import { Meta } from "../src/lib/contracts";
import { readPublication, publicationScope } from "../../web/lib/workers-host/publication-fence";
import { readView } from "../../web/lib/data/source";
import { withWorkerEnv } from "../../web/lib/workers-host/runtime-env";
import type { R2Bucket } from "../../web/lib/storage/r2-binding-store";
import { fixtureRecords, startFixture } from "../scripts/fixture";

test("native R2 and the existing web reader consume identical captured-publication contracts", async () => {
  const records = fixtureRecords();
  const server = startFixture(records);
  const bucket: R2Bucket = {
    async get(key) {
      const body = records.get(key);
      if (body === undefined) return null;
      return { key, size: body.length, etag: key, httpEtag: `"${key}"`, text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer };
    },
    head: async () => null,
    put: async () => { throw new Error("Read-only facade must never write"); },
    delete: async () => { throw new Error("Read-only facade must never delete"); },
    list: async () => { throw new Error("Read-only facade must never list"); },
  };
  try {
    for (const layout of ["managed", "bootstrap", "flat"]) {
      if (layout === "bootstrap") {
        records.set("bootstrap/latest.json", JSON.stringify({ schema_ver: 1, generation: "bootstrap-fixture", prefix: "bootstrap/generations/bootstrap-fixture", previous_generation: null, published_at: "2026-10-21T00:00:00.000Z", base_manifest_sha256: "a".repeat(64), canonical_manifest_sha256: "b".repeat(64) }));
        records.set("bootstrap/generations/bootstrap-fixture/views/meta.json", records.get("meta.json")!);
      } else if (layout === "flat") { records.delete("views/latest.json"); records.delete("bootstrap/latest.json"); }
      const publication = await readPublication(async (key) => records.has(key) ? { body: records.get(key)!, etag: key } : null);
      const actual = await pageData(bucket, publication).base("meta.json", Meta);
      const expected = await withWorkerEnv({ STORAGE_READ_DRIVER: "blob", BLOB_BASE_URL: server.url.origin, VIEWS_VERSION_FALLBACK: "" }, () => publicationScope.run(publication, () => readView("meta.json", Meta, { base: true, skipNextDataCache: true, bust: `astro-${layout}` })));
      expect(actual).toEqual(expected);
      expect(actual?.generated_at).toBe("2026-07-17T00:00:00.000Z");
    }
    const publication = await readPublication(async () => null);
    expect(await pageData(bucket, publication).base("missing.json", Meta)).toBeNull();
    records.set("meta.json", '{"unexpected":true}');
    expect(pageData(bucket, publication).base("meta.json", Meta)).rejects.toThrow();
    expect(pageData(bucket, publication).base("../meta.json", Meta)).rejects.toThrow();
  } finally { await server.stop(true); }
});

test("the common HTTP fixture refuses mutation and supports HEAD", async () => {
  const fixture = startFixture();
  try {
    expect((await fetch(fixture.url, { method: "POST" })).status).toBe(405);
    const head = await fetch(new URL("meta.json", fixture.url), { method: "HEAD" });
    expect(head.status).toBe(200); expect(await head.text()).toBe("");
    expect(head.headers.has("etag")).toBe(true);
  } finally { await fixture.stop(true); }
});
