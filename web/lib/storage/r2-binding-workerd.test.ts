import { afterEach, expect, test } from "bun:test";
import { Miniflare } from "miniflare";
import { ObjectStorePreconditionFailedError } from "./errors";
import { createObjectStoreBootstrapAdapter } from "./bootstrap-adapter";
import { R2BindingObjectStore, type R2Bucket } from "./r2-binding-store";

/**
 * Local workerd check. The binary is the `workerd` package already installed
 * with wrangler (1.20260916.1), so this stays inside `bun test` and does not
 * change CI. Telemetry stays off. No Cloudflare account and no remote bucket.
 */
let miniflare: Miniflare | undefined;

afterEach(async () => {
  await miniflare?.dispose();
  miniflare = undefined;
});

async function workerdBucket(): Promise<R2Bucket> {
  miniflare = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "r2-etag",
          type: "worker",
          compatibilityDate: "2026-09-01",
          manifest: {
            mainModule: "worker.js",
            modules: {
              "worker.js": {
                type: "esm",
                contents: "export default { async fetch() { return new Response('ok'); } }",
              },
            },
          },
          env: {
            DATA: { type: "r2", name: "binding-etag-test" },
          },
        },
      },
    ],
  });
  return (await miniflare.getR2Bucket("DATA")) as unknown as R2Bucket;
}

test("workerd binding preserves staged binary bytes and their ETag for bootstrap publication", async () => {
  const bucket = await workerdBucket();
  const store = new R2BindingObjectStore({ bucket, prefix: "fixture/" });
  const path = "canonical/star_daily.parquet";
  const bytes = new Uint8Array([0x50, 0x41, 0x52, 0x31, 0x00, 0x80, 0xff, 0xc3, 0x28]);
  const created = await store.put(path, bytes, { contentType: "application/vnd.apache.parquet" });
  expect(await store.getBytes("missing")).toBeNull();
  const binary = await store.getBytes(path);
  expect(binary).toMatchObject({ etag: created.etag, size: bytes.length, contentType: "application/vnd.apache.parquet" });
  expect(binary?.body).toEqual(bytes);
  const adapter = createObjectStoreBootstrapAdapter(store);
  const snapshot = await adapter.readSnapshot(path);
  expect(snapshot.etag).toBe(created.etag);
  expect(snapshot.body).toEqual(Buffer.from(bytes));
  expect(await adapter.read(path)).toEqual(Buffer.from(bytes));
});

test("workerd rejects a quoted conditional and accepts the unquoted etag from the store", async () => {
  const bucket = await workerdBucket();
  await bucket.put("views/a.json", "one");
  const head = await bucket.head("views/a.json");
  if (!head) throw new Error("expected the seeded object");
  expect(head.httpEtag).toBe(`"${head.etag}"`);
  expect(head.etag.startsWith('"')).toBe(false);

  await expect(bucket.put("views/a.json", "bad", { onlyIf: { etagMatches: head.httpEtag } })).rejects.toThrow(
    `Conditional ETag should not be wrapped in quotes (${head.httpEtag}).`,
  );
  await expect(bucket.put("views/a.json", "bad", { onlyIf: { etagDoesNotMatch: head.httpEtag } })).rejects.toThrow(
    TypeError,
  );
  await expect(
    bucket.put("views/a.json", "bad", { onlyIf: { etagMatches: "stale", etagDoesNotMatch: head.httpEtag } }),
  ).rejects.toThrow(`Conditional ETag should not be wrapped in quotes (${head.httpEtag}).`);
  await expect(
    bucket.put("missing-combo", "no", { onlyIf: { etagMatches: "*", etagDoesNotMatch: head.httpEtag } }),
  ).rejects.toThrow(TypeError);
  expect(await bucket.head("missing-combo")).toBeNull();
  expect(await (await bucket.get("views/a.json"))?.text()).toBe("one");
  expect(await bucket.put("views/a.json", "weak", { onlyIf: { etagMatches: `W/"${head.etag}"` } })).toBeNull();
  expect(await bucket.put("missing", "no", { onlyIf: { etagMatches: "*" } })).toBeNull();
  expect(await bucket.put("views/a.json", "star", { onlyIf: { etagMatches: "*" } })).not.toBeNull();
  expect(await (await bucket.get("views/a.json"))?.text()).toBe("star");

  const store = new R2BindingObjectStore({ bucket, bucketName: "binding-etag-test" });
  const created = await store.put("views/b.json", "one", { allowOverwrite: false });
  expect(created.etag.startsWith('"')).toBe(true);
  await expect(store.put("views/b.json", "two", { allowOverwrite: false })).rejects.toBeInstanceOf(
    ObjectStorePreconditionFailedError,
  );
  const current = (await store.get("views/b.json"))?.etag;
  if (typeof current !== "string") throw new Error("expected a quoted etag");
  const updated = await store.put("views/b.json", "two", { ifMatch: current });
  expect(updated.etag.startsWith('"')).toBe(true);
  expect(updated.etag).not.toBe(current);
  expect((await store.get("views/b.json"))?.body).toBe("two");
  await expect(store.put("views/b.json", "three", { ifMatch: `W/${updated.etag}` })).rejects.toBeInstanceOf(
    ObjectStorePreconditionFailedError,
  );
  expect((await store.get("views/b.json"))?.body).toBe("two");
});
