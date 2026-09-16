import { describe, expect, test } from "bun:test";
import { DualReadObjectStore } from "./dual-read-store";
import { MemoryObjectStore } from "./memory-store";

describe("DualReadObjectStore", () => {
  test("returns the primary object when present", async () => {
    const primary = new MemoryObjectStore({ "views/latest.json": '{"from":"r2"}' });
    const fallback = new MemoryObjectStore({ "views/latest.json": '{"from":"blob"}' });
    const store = new DualReadObjectStore(primary, fallback);
    expect(JSON.parse((await store.get("views/latest.json"))?.body ?? "null")).toEqual({ from: "r2" });
  });

  test("falls back when the primary misses", async () => {
    const primary = new MemoryObjectStore();
    const fallback = new MemoryObjectStore({ "views/latest.json": '{"from":"blob"}' });
    const store = new DualReadObjectStore(primary, fallback);
    expect(JSON.parse((await store.get("views/latest.json"))?.body ?? "null")).toEqual({ from: "blob" });
  });

  test("falls back when the primary throws", async () => {
    const primary = new MemoryObjectStore();
    primary.get = async () => {
      throw new Error("r2 unavailable");
    };
    const fallback = new MemoryObjectStore({ "live/latest.json": '{"from":"blob"}' });
    const store = new DualReadObjectStore(primary, fallback);
    expect(JSON.parse((await store.get("live/latest.json"))?.body ?? "null")).toEqual({ from: "blob" });
  });

  test("refuses writes so CAS cannot target the wrong driver", async () => {
    const store = new DualReadObjectStore(new MemoryObjectStore(), new MemoryObjectStore());
    await expect(store.put("x.json", "{}")).rejects.toThrow("read-only");
    await expect(store.del("x.json")).rejects.toThrow("read-only");
  });
});
