import { describe, expect, test } from "bun:test";
import { BlobHealthStore, mergePipelineHealth } from "@/lib/observability/health";
import { BlobLivePublicationStore } from "@/lib/cron/live-publication";
import { LiveGenerationPointer } from "@/lib/contracts";
import { isObjectStoreConflict, MemoryObjectStore, ObjectStorePreconditionFailedError } from "./index";
import { BlobWorkflowLeaseStore } from "@/lib/workflows/lease";
import { WorkflowLease } from "@/lib/contracts";

describe("MemoryObjectStore CAS", () => {
  test("create-if-absent and If-Match conflict return 412", async () => {
    const store = new MemoryObjectStore();
    const first = await store.put("ops/workflows/active.json", JSON.stringify({ n: 1 }), { allowOverwrite: false });
    await expect(store.put("ops/workflows/active.json", JSON.stringify({ n: 2 }), { allowOverwrite: false })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    await expect(store.put("ops/workflows/active.json", JSON.stringify({ n: 2 }), { ifMatch: '"stale"' })).rejects.toBeInstanceOf(
      ObjectStorePreconditionFailedError,
    );
    const second = await store.put("ops/workflows/active.json", JSON.stringify({ n: 2 }), { ifMatch: first.etag });
    expect(second.etag).not.toBe(first.etag);
    expect((await store.get("ops/workflows/active.json"))?.body).toBe(JSON.stringify({ n: 2 }));
  });

  test("list prefix and folded folders", async () => {
    const store = new MemoryObjectStore({
      "views/run-b/meta.json": "{}",
      "views/run-a/meta.json": "{}",
      "views/latest.json": "{}",
    });
    const folded = await store.list({ prefix: "views/", mode: "folded" });
    expect(folded.folders).toEqual(["views/run-a/", "views/run-b/"]);
    expect(folded.blobs.map((blob) => blob.pathname)).toEqual(["views/latest.json"]);
    const expanded = await store.list({ prefix: "views/run-a/" });
    expect(expanded.blobs.map((blob) => blob.pathname)).toEqual(["views/run-a/meta.json"]);
    await store.del("views/latest.json");
    expect(await store.get("views/latest.json")).toBeNull();
  });
});

describe("object-store adapters on existing ports", () => {
  test("workflow lease CAS loses on a stale ETag", async () => {
    const objects = new MemoryObjectStore();
    const store = new BlobWorkflowLeaseStore(undefined, objects);
    const lease = WorkflowLease.parse({
      run_id: "refresh-a",
      status: "running",
      acquired_at: "2026-09-16T00:00:00.000Z",
      expires_at: "2026-09-16T00:30:00.000Z",
      fencing_token: 1,
      idempotency_key: "manual-a",
      trigger: "test",
    });
    expect(await store.create(lease)).toBe(true);
    expect(await store.compareAndSet('"stale"', lease)).toBe(false);
    const current = await store.read();
    expect(current.etag).toBeTruthy();
    expect(await store.compareAndSet(current.etag!, { ...lease, fencing_token: 2 })).toBe(true);
  });

  test("health CAS loses on a stale ETag", async () => {
    const objects = new MemoryObjectStore();
    const store = new BlobHealthStore(objects);
    const health = mergePipelineHealth(null, "cron-daily", "ok", { run_id: "daily-1" }, new Date("2026-09-16T00:00:00.000Z"));
    expect(await store.create("cron-daily", health)).toBe(true);
    expect(await store.compareAndSet("cron-daily", '"stale"', health)).toBe(false);
  });

  test("live pointer If-Match conflict is not a successful commit", async () => {
    const objects = new MemoryObjectStore();
    const store = new BlobLivePublicationStore(objects);
    const pointer = LiveGenerationPointer.parse({
      schema_ver: 1,
      generation: "g1",
      run_id: "g1",
      idempotency_key: "daily:2026-09-16",
      job: "daily",
      day: "2026-09-16",
      month: "2026-09",
      week: "2026-W38",
      published_at: "2026-09-16T00:00:00.000Z",
      previous_generation: null,
      lease: null,
    });
    expect(await store.createControl(pointer)).toBe(true);
    expect(await store.compareAndSetControl('"stale"', pointer)).toBe(false);
    const head = await store.headEtag();
    expect(head).toBeTruthy();
    expect(await store.compareAndSetControl(head!, { ...pointer, generation: "g2", run_id: "g2" })).toBe(true);
  });

  test("isObjectStoreConflict recognizes 412", () => {
    expect(isObjectStoreConflict(new ObjectStorePreconditionFailedError())).toBe(true);
    const named = new Error("ETag mismatch");
    named.name = "BlobPreconditionFailedError";
    expect(isObjectStoreConflict(named)).toBe(true);
    expect(isObjectStoreConflict(new Error("precondition 412"))).toBe(true);
    expect(isObjectStoreConflict(new Error("boom"))).toBe(false);
  });
});
