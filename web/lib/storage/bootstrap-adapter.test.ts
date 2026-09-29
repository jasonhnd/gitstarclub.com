import { describe, expect, test } from "bun:test";
import { createObjectStoreBootstrapAdapter } from "./bootstrap-adapter";
import { MemoryObjectStore } from "./memory-store";

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
});
