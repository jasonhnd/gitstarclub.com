import { describe, expect, test } from "bun:test";
import { commitBootstrapGeneration, stageBootstrapPhase } from "../../../pipeline/lib/bootstrap-publication.mjs";
import { createObjectStoreBootstrapAdapter } from "./bootstrap-adapter";
import { MemoryObjectStore } from "./memory-store";
import { R2S3ObjectStore } from "./r2-s3-store";
import type { ObjectStore } from "./types";

const PARQUET = Uint8Array.from([0x50, 0x41, 0x52, 0x31, 0x00, 0xff, 0x0a, 0x80, 0x7f, 0x1f, 0x8b]);

function bytePreservingR2() {
  const objects = new Map<string, Uint8Array>();
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? "GET";
    const key = new URL(url).pathname;
    if (method === "PUT") {
      const raw = init?.body;
      const bytes =
        raw instanceof Uint8Array
          ? new Uint8Array(raw)
          : raw instanceof ArrayBuffer
            ? new Uint8Array(raw)
            : new Uint8Array();
      objects.set(key, bytes);
      return new Response(null, { status: 200, headers: { etag: '"staged"' } });
    }
    if (method === "GET") {
      const bytes = objects.get(key);
      if (!bytes) return new Response(null, { status: 404 });
      return new Response(bytes, {
        status: 200,
        headers: { etag: '"staged"', "content-type": "application/octet-stream" },
      });
    }
    return new Response("unexpected", { status: 500 });
  };
  return new R2S3ObjectStore({
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "test-secret-not-printed",
    bucket: "gitstarclub-data-pre",
    endpoint: "https://00112233445566778899aabbccddeeff.r2.cloudflarestorage.com",
    now: () => new Date("2026-09-29T00:00:00.000Z"),
    fetch: fetchImpl,
  });
}

describe("object store bootstrap adapter", () => {
  test("create, compare-and-set, and delete round-trip JSON bytes", async () => {
    const memory = new MemoryObjectStore();
    const store = createObjectStoreBootstrapAdapter(memory);
    const body = Buffer.from('{"ok":true}');

    expect(await store.read("bootstrap/latest.json")).toBeNull();
    expect(await store.create("bootstrap/latest.json", body, "application/json")).toBe(true);
    expect(await store.create("bootstrap/latest.json", Buffer.from("other"))).toBe(false);
    const snapshot = await store.readSnapshot("bootstrap/latest.json");
    expect(snapshot.body?.equals(body)).toBe(true);
    expect(snapshot.etag).toBeTruthy();

    expect(await store.compareAndSet("bootstrap/latest.json", '"stale"', Buffer.from('{"ok":false}'))).toBe(false);
    expect(await store.compareAndSet("bootstrap/latest.json", snapshot.etag ?? "", Buffer.from('{"ok":false}'))).toBe(
      true,
    );
    expect(await store.createMutable("ops/workflows/active.json", Buffer.from("{}"))).toBe(true);
    expect(await store.createMutable("ops/workflows/active.json", Buffer.from("{}"))).toBe(false);
    await store.put("bootstrap/latest.json", Buffer.from('{"ok":2}'));
    expect((await store.read("bootstrap/latest.json"))?.toString()).toBe('{"ok":2}');
    await store.delete("bootstrap/latest.json");
    expect(await store.read("bootstrap/latest.json")).toBeNull();
  });

  test("refuses a store that can only read text", async () => {
    const store = createObjectStoreBootstrapAdapter({} as ObjectStore);
    await expect(store.read("canonical/star_daily.parquet")).rejects.toThrow("cannot read binary");
    await expect(store.readSnapshot("canonical/star_daily.parquet")).rejects.toThrow("cannot read binary");
  });

  test("commits a generation whose staged parquet is not valid UTF-8", async () => {
    const r2 = bytePreservingR2();
    const store = createObjectStoreBootstrapAdapter(r2);
    const generation = "bootstrap-parquet-bytes";
    const parquetPath = `bootstrap/generations/${generation}/canonical/star_daily.parquet`;
    await stageBootstrapPhase({
      generation,
      phase: "base",
      store,
      items: [
        { path: "views/meta.json", body: Buffer.from('{"ok":true}'), contentType: "application/json" },
        {
          path: "canonical/star_daily.parquet",
          body: Buffer.from(PARQUET),
          contentType: "application/vnd.apache.parquet",
        },
      ],
    });
    await stageBootstrapPhase({
      generation,
      phase: "canonical",
      store,
      items: [{ path: "canonical/v2/meta.json", body: Buffer.from('{"ok":true}'), contentType: "application/json" }],
    });

    const asText = await r2.get(parquetPath);
    expect(Buffer.from(asText?.body ?? "").equals(Buffer.from(PARQUET))).toBe(false);

    const committed = await commitBootstrapGeneration({
      generation,
      store,
      initialCommit: true,
      now: () => "2026-09-29T00:00:00.000Z",
    });
    expect(committed.status).toBe("published");
    expect(committed.pointer.previous_generation).toBeNull();
    const roundTrip = await store.read(parquetPath);
    expect(roundTrip?.byteLength).toBe(PARQUET.byteLength);
    expect(roundTrip?.equals(Buffer.from(PARQUET))).toBe(true);
  });
});
