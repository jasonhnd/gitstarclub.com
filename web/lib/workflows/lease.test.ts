import { describe, expect, test } from "bun:test";
import type { WorkflowLease } from "@/lib/contracts";
import { acquireWorkflowLease, releaseWorkflowLease, type StoredWorkflowLease, type WorkflowLeaseStore } from "./lease";

const NOW = new Date("2026-07-05T06:00:00.000Z");

class MemoryLeaseStore implements WorkflowLeaseStore {
  private lease: WorkflowLease | null;
  private revision = 0;

  constructor(initial?: WorkflowLease) {
    this.lease = initial ?? null;
    if (initial) this.revision = 1;
  }

  async readActive(): Promise<StoredWorkflowLease | null> {
    if (!this.lease) return null;
    return { lease: structuredClone(this.lease), etag: String(this.revision) };
  }

  async createActive(lease: WorkflowLease): Promise<"created" | "conflict"> {
    if (this.lease) return "conflict";
    this.lease = structuredClone(lease);
    this.revision++;
    return "created";
  }

  async updateActive(lease: WorkflowLease, etag: string): Promise<"updated" | "conflict"> {
    if (etag !== String(this.revision)) return "conflict";
    this.lease = structuredClone(lease);
    this.revision++;
    return "updated";
  }
}

function runningLease(overrides: Partial<WorkflowLease> = {}): WorkflowLease {
  return {
    run_id: "refresh-existing",
    status: "running",
    acquired_at: "2026-07-05T05:00:00.000Z",
    expires_at: "2026-07-05T17:00:00.000Z",
    trigger_period: "2026-W27",
    idempotency_key: "refresh:2026-W27",
    last_event: "acquired",
    last_triggered_at: "2026-07-05T05:00:00.000Z",
    ...overrides,
  };
}

describe("workflow lease acquisition", () => {
  test("concurrent same-period acquisition creates one lease and attaches the retry", async () => {
    const store = new MemoryLeaseStore();

    const results = await Promise.all([
      acquireWorkflowLease({ runId: "refresh-a", triggerPeriod: "2026-W27", requestedAt: NOW, store }),
      acquireWorkflowLease({ runId: "refresh-b", triggerPeriod: "2026-W27", requestedAt: NOW, store }),
    ]);

    expect(results.map((result) => result.action).sort()).toEqual(["acquired", "attached"]);
    const attached = results.find((result) => result.action === "attached");
    const acquired = results.find((result) => result.action === "acquired");
    expect(attached?.runId).toBe(acquired?.runId);
  });

  test("fresh active lease for a different period returns conflict", async () => {
    const store = new MemoryLeaseStore(runningLease({ trigger_period: "2026-W26", idempotency_key: "refresh:2026-W26" }));

    const result = await acquireWorkflowLease({ runId: "refresh-new", triggerPeriod: "2026-W27", requestedAt: NOW, store });

    expect(result.action).toBe("conflict");
    expect(result.runId).toBe("refresh-existing");
    expect(result.reason).toContain("already running");
  });

  test("expired running lease can be taken over", async () => {
    const store = new MemoryLeaseStore(runningLease({ expires_at: "2026-07-05T05:59:59.000Z" }));

    const result = await acquireWorkflowLease({ runId: "refresh-new", triggerPeriod: "2026-W27", requestedAt: NOW, store });

    expect(result.action).toBe("taken_over");
    expect(result.runId).toBe("refresh-new");
    expect(result.lease.last_event).toBe("taken_over");
  });

  test("same-period retry after published status attaches to the existing run", async () => {
    const store = new MemoryLeaseStore(
      runningLease({
        status: "published",
        expires_at: "2026-07-05T05:30:00.000Z",
        last_event: "released",
      }),
    );

    const result = await acquireWorkflowLease({ runId: "refresh-later", triggerPeriod: "2026-W27", requestedAt: NOW, store });

    expect(result.action).toBe("attached");
    expect(result.runId).toBe("refresh-existing");
  });

  test("same-period retry after failed status can start a replacement run", async () => {
    const store = new MemoryLeaseStore(
      runningLease({
        status: "failed",
        expires_at: "2026-07-05T05:30:00.000Z",
        last_event: "released",
      }),
    );

    const result = await acquireWorkflowLease({ runId: "refresh-retry", triggerPeriod: "2026-W27", requestedAt: NOW, store });

    expect(result.action).toBe("taken_over");
    expect(result.runId).toBe("refresh-retry");
  });

  test("release ignores stale runs after another run takes the active lease", async () => {
    const store = new MemoryLeaseStore(runningLease({ run_id: "refresh-new", trigger_period: "2026-W28" }));

    await releaseWorkflowLease("refresh-old", "failed", { releasedAt: NOW, store });

    const active = await store.readActive("check");
    expect(active?.lease.run_id).toBe("refresh-new");
    expect(active?.lease.status).toBe("running");
  });
});
