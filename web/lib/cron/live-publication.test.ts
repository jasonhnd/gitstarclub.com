import { describe, expect, test } from "bun:test";
import { LiveGenerationPointer, type LiveGenerationPointer as Pointer } from "@/lib/contracts";
import {
  LIVE_POINTER_CACHE_CONTROL_MAX_AGE,
  livePointerReadUrl,
  claimLivePublication,
  publishLiveGeneration,
  releaseLivePublication,
  type LiveControlSnapshot,
  type LivePublicationStore,
} from "./live-publication";

const NOW = Date.parse("2026-07-17T03:00:00.000Z");

function publishedPointer(generation = "old-generation", idempotencyKey = "daily:2026-07-16"): Pointer {
  return LiveGenerationPointer.parse({
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: idempotencyKey,
    job: "daily",
    day: "2026-07-16",
    month: "2026-07",
    week: "2026-W29",
    published_at: "2026-07-16T03:00:00.000Z",
    previous_generation: null,
    lease: null,
  });
}

class MemoryStore implements LivePublicationStore {
  pointer: Pointer | null;
  etag = 1;
  objects = new Map<string, string>();
  writes = 0;
  failWriteAt: number | null = null;

  constructor(pointer: Pointer | null = publishedPointer()) {
    this.pointer = pointer;
  }

  async readControl(): Promise<LiveControlSnapshot> {
    return { pointer: this.pointer ? structuredClone(this.pointer) : null, etag: this.pointer ? String(this.etag) : null };
  }

  async createControl(pointer: Pointer): Promise<boolean> {
    this.maybeFail();
    if (this.pointer) return false;
    this.pointer = structuredClone(pointer);
    this.etag++;
    return true;
  }

  async compareAndSetControl(etag: string, pointer: Pointer): Promise<boolean> {
    this.maybeFail();
    if (!this.pointer || etag !== String(this.etag)) return false;
    this.pointer = structuredClone(pointer);
    this.etag++;
    return true;
  }

  async putImmutable(path: string, data: unknown): Promise<void> {
    this.maybeFail();
    const payload = JSON.stringify(data);
    const existing = this.objects.get(path);
    if (existing != null && existing !== payload) throw new Error(`immutable conflict: ${path}`);
    this.objects.set(path, payload);
  }

  async putMutable(path: string, data: unknown): Promise<void> {
    this.maybeFail();
    this.objects.set(path, JSON.stringify(data));
  }

  async headEtag(): Promise<string | null> {
    return this.pointer ? String(this.etag) : null;
  }

  resetFault(failWriteAt: number | null): void {
    this.writes = 0;
    this.failWriteAt = failWriteAt;
  }

  private maybeFail(): void {
    this.writes++;
    if (this.writes === this.failWriteAt) throw new Error(`injected write failure ${this.writes}`);
  }
}

async function acquire(store: MemoryStore, runId = "daily-2026-07-17-run", key = "daily:2026-07-17") {
  return claimLivePublication(
    {
      runId,
      idempotencyKey: key,
      job: "daily",
      acquiredAt: new Date(NOW).toISOString(),
      now: NOW,
    },
    store,
  );
}

function publishArgs(runId = "daily-2026-07-17-run", key = "daily:2026-07-17") {
  return {
    runId,
    idempotencyKey: key,
    job: "daily" as const,
    day: "2026-07-17",
    month: "2026-07",
    week: "2026-W29",
    createdAt: new Date(NOW).toISOString(),
    now: NOW,
    prerequisites: [{ path: "canonical/v2/pending/2026-06.json", data: { complete: true } }],
    artifacts: [
      { path: "current_month.json", data: { generation: "new", kind: "current-month" } },
      { path: "hot-snapshot.json", data: { generation: "new", kind: "hot" } },
      { path: "rank/month/2026-07/repo/flow.json", data: { generation: "new", kind: "rank" } },
    ],
  };
}

describe("live publication control", () => {
  test("two concurrent different jobs are fenced to one active writer", async () => {
    const store = new MemoryStore();
    const [daily, weekly] = await Promise.all([
      acquire(store, "daily-run", "daily:2026-07-17"),
      claimLivePublication(
        {
          runId: "weekly-run",
          idempotencyKey: "weekly:2026-07-17",
          job: "weekly",
          acquiredAt: new Date(NOW).toISOString(),
          now: NOW,
        },
        store,
      ),
    ]);

    expect([daily.status, weekly.status].sort()).toEqual(["acquired", "rejected"]);
    expect(store.pointer?.generation).toBe("old-generation");
  });

  test("a duplicate idempotency key attaches while running and returns committed after publish", async () => {
    const store = new MemoryStore();
    expect((await acquire(store, "run-a")).status).toBe("acquired");
    expect((await acquire(store, "run-b")).status).toBe("attached");

    await publishLiveGeneration(publishArgs("run-a"), store);
    const duplicate = await acquire(store, "run-c");

    expect(duplicate.status).toBe("committed");
    if (duplicate.status === "committed") expect(duplicate.pointer.generation).toBe("run-a");
  });
});
describe("publishLiveGeneration", () => {
  test("a failure at every object write leaves readers on the previous complete generation", async () => {
    // prerequisite + 3 artifacts + manifest + pointer CAS
    for (let fault = 1; fault <= 6; fault++) {
      const store = new MemoryStore();
      expect((await acquire(store)).status).toBe("acquired");
      store.resetFault(fault);

      await expect(publishLiveGeneration(publishArgs(), store)).rejects.toThrow(`injected write failure ${fault}`);

      expect(store.pointer?.generation).toBe("old-generation");
      expect(store.pointer?.published_at).toBe("2026-07-16T03:00:00.000Z");
    }
  });

  test("retry after a partial failure reuses identical immutable files and commits once complete", async () => {
    const store = new MemoryStore();
    expect((await acquire(store)).status).toBe("acquired");
    store.resetFault(4); // after prerequisite + two generation files
    await expect(publishLiveGeneration(publishArgs(), store)).rejects.toThrow("injected write failure 4");

    store.resetFault(null);
    expect(await releaseLivePublication("daily-2026-07-17-run", store)).toBe(true);
    expect((await acquire(store)).status).toBe("acquired");
    const result = await publishLiveGeneration(publishArgs(), store);

    expect(result.generation).toBe("daily-2026-07-17-run");
    expect(store.pointer?.generation).toBe("daily-2026-07-17-run");
    expect(store.pointer?.lease).toBeNull();
    expect(store.objects.has("live/generations/daily-2026-07-17-run/manifest.json")).toBe(true);
  });

  test("control-plane pointer reads cache-bust the public URL (useCache:false is private-only)", () => {
    expect(LIVE_POINTER_CACHE_CONTROL_MAX_AGE).toBe(0);
    expect(livePointerReadUrl("https://blob.example", 1_776_297_908_310)).toBe(
      "https://blob.example/live/latest.json?v=1776297908310",
    );
  });

  test("a publish that re-reads the pre-lease pointer is fenced (stale CDN)", async () => {
    const store = new MemoryStore();
    expect((await acquire(store)).status).toBe("acquired");
    const leased = structuredClone(store.pointer);
    store.pointer = publishedPointer();
    store.etag++;

    await expect(publishLiveGeneration(publishArgs(), store)).rejects.toThrow("fenced before commit");
    expect(store.pointer.generation).toBe("old-generation");
    expect(leased?.lease?.run_id).toBe("daily-2026-07-17-run");
  });

  test("publish succeeds when the public pointer body is stale but origin etag is unchanged", async () => {
    const store = new MemoryStore();
    const claim = await acquire(store);
    expect(claim.status).toBe("acquired");
    if (claim.status !== "acquired") throw new Error("expected acquire");
    store.pointer = publishedPointer();

    await publishLiveGeneration(
      {
        ...publishArgs(),
        claimedEtag: claim.etag,
        claimedPreviousGeneration: claim.previous_generation,
      },
      store,
    );

    expect(store.pointer.generation).toBe("daily-2026-07-17-run");
    expect(store.pointer.lease).toBeNull();
  });

  test("a stolen or expired lease cannot flip the pointer", async () => {
    const store = new MemoryStore();
    expect((await acquire(store)).status).toBe("acquired");
    store.pointer = LiveGenerationPointer.parse({
      ...store.pointer!,
      lease: {
        run_id: "successor",
        idempotency_key: "weekly:2026-07-17",
        job: "weekly",
        acquired_at: new Date(NOW).toISOString(),
        expires_at: new Date(NOW + 60_000).toISOString(),
      },
    });
    store.etag++;

    await expect(publishLiveGeneration(publishArgs(), store)).rejects.toThrow("fenced before commit");
    expect(store.pointer.generation).toBe("old-generation");
  });
});
