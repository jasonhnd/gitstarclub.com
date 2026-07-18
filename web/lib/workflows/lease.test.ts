import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import { claimWorkflowLease, type WorkflowLeaseSnapshot, type WorkflowLeaseStore } from "./lease";

class MemoryLeaseStore implements WorkflowLeaseStore {
  lease: WorkflowLease | null;
  etag: string | null;
  private version = 0;
  private blockedReads = 0;
  private releaseReads: (() => void) | null = null;
  private readonly readGate: Promise<void> | null;

  constructor(initial: WorkflowLease | null = null, barrierReads = 0) {
    this.lease = initial ? structuredClone(initial) : null;
    this.etag = initial ? `"${++this.version}"` : null;
    this.readGate =
      barrierReads > 0
        ? new Promise((resolve) => {
            this.releaseReads = resolve;
          })
        : null;
  }

  async read(): Promise<WorkflowLeaseSnapshot> {
    const snapshot = {
      lease: this.lease ? structuredClone(this.lease) : null,
      etag: this.etag,
    };
    if (this.readGate && this.blockedReads < 2) {
      this.blockedReads += 1;
      if (this.blockedReads === 2) this.releaseReads?.();
      await this.readGate;
    }
    return snapshot;
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    if (this.lease) return false;
    this.lease = structuredClone(lease);
    this.etag = `"${++this.version}"`;
    return true;
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    if (this.etag !== etag) return false;
    this.lease = structuredClone(lease);
    this.etag = `"${++this.version}"`;
    return true;
  }
}

function runningLease(runId: string, acquiredAt: string, expiresAt: string, idempotencyKey: string): WorkflowLease {
  return WorkflowLease.parse({
    run_id: runId,
    status: "running",
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    idempotency_key: idempotencyKey,
    trigger: "test",
  });
}

describe("workflow lease acquisition", () => {
  test("only one concurrent claimant can acquire an empty lease", async () => {
    const store = new MemoryLeaseStore(null, 2);
    const now = Date.parse("2026-07-05T06:00:00.000Z");

    const results = await Promise.all([
      claimWorkflowLease(
        {
          runId: "refresh-a",
          acquiredAt: "2026-07-05T06:00:00.000Z",
          idempotencyKey: "manual-a",
          trigger: "test",
          now,
        },
        store,
      ),
      claimWorkflowLease(
        {
          runId: "refresh-b",
          acquiredAt: "2026-07-05T06:00:00.000Z",
          idempotencyKey: "manual-b",
          trigger: "test",
          now,
        },
        store,
      ),
    ]);

    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.lease?.status).toBe("running");
  });

  test("a new run can atomically take over an expired lease", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-old", "2026-07-04T06:00:00.000Z", "2026-07-04T18:00:00.000Z", "workflow-refresh:2026-W27"),
    );

    const result = await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W28",
        trigger: "test",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    expect(result.status).toBe("acquired");
    expect(result.lease.run_id).toBe("refresh-new");
    expect(store.lease?.run_id).toBe("refresh-new");
  });

  test("same-period retry attaches to the existing active run", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-existing", "2026-07-05T06:00:00.000Z", "2026-07-05T18:00:00.000Z", "workflow-refresh:2026-W27"),
    );

    const result = await claimWorkflowLease(
      {
        runId: "refresh-retry",
        acquiredAt: "2026-07-05T06:01:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W27",
        trigger: "test",
        now: Date.parse("2026-07-05T06:01:00.000Z"),
      },
      store,
    );

    expect(result.status).toBe("attached");
    expect(result.lease.run_id).toBe("refresh-existing");
  });

  test("release falls back to forceWrite when CAS keeps conflicting", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-stuck", "2026-07-18T02:00:00.000Z", "2026-07-18T14:00:00.000Z", "recovery-1"),
    );
    // Simulate perpetual CAS conflict (edge etag thrash) while still owning the run.
    store.compareAndSet = async () => false;
    let forced: WorkflowLease | null = null;
    store.forceWrite = async (lease) => {
      forced = structuredClone(lease);
      store.lease = structuredClone(lease);
      store.etag = `"forced"`;
    };

    const { releaseWorkflowLease } = await import("./lease");
    const ok = await releaseWorkflowLease("refresh-stuck", "published", store, "2026-07-18T02:30:00.000Z");
    expect(ok).toBe(true);
    expect(forced?.status).toBe("published");
    expect(store.lease?.status).toBe("published");
  });
});

