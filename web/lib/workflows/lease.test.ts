import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import {
  LEASE_TTL_MS,
  claimWorkflowLease,
  releaseWorkflowLease,
  renewWorkflowLease,
  type WorkflowLeaseSnapshot,
  type WorkflowLeaseStore,
} from "./lease";

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

function runningLease(
  runId: string,
  acquiredAt: string,
  expiresAt: string,
  idempotencyKey: string,
  fencingToken = 1,
): WorkflowLease {
  return WorkflowLease.parse({
    run_id: runId,
    status: "running",
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    fencing_token: fencingToken,
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
    expect(result.lease.fencing_token).toBe(2);
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

  test("heartbeat extends the lease without changing its fencing generation", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:20:00.000Z", "manual-a", 9),
    );

    const renewedAt = "2026-07-05T06:10:00.000Z";
    const renewed = await renewWorkflowLease("refresh-a", 9, store, renewedAt);

    expect(renewed.fencing_token).toBe(9);
    expect(renewed.expires_at).toBe(new Date(Date.parse(renewedAt) + LEASE_TTL_MS).toISOString());
    expect(store.lease).toEqual(renewed);
  });

  test("an expired/taken-over run cannot renew, mutate, or release the new generation", async () => {
    const old = runningLease("refresh-old", "2026-07-05T05:00:00.000Z", "2026-07-05T05:30:00.000Z", "manual-old", 4);
    const store = new MemoryLeaseStore(old);
    const takeover = await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "manual-new",
        trigger: "test",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    expect(takeover.lease.fencing_token).toBe(5);
    await expect(renewWorkflowLease("refresh-old", 4, store, "2026-07-05T06:01:00.000Z")).rejects.toThrow(
      "no longer owns fencing token 4",
    );
    expect(await releaseWorkflowLease("refresh-old", "failed", store, "2026-07-05T06:01:00.000Z", 4)).toBe(false);
    expect(store.lease?.run_id).toBe("refresh-new");
    expect(store.lease?.fencing_token).toBe(5);
  });

  test("a heartbeat after the lease deadline fails closed", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:20:00.000Z", "manual-a", 3),
    );

    await expect(renewWorkflowLease("refresh-a", 3, store, "2026-07-05T06:20:00.000Z")).rejects.toThrow("lease expired");
    expect(store.lease?.expires_at).toBe("2026-07-05T06:20:00.000Z");
  });

  test("delayed start of an old run cannot attach after a successor lease is acquired", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-old", "2026-07-05T05:00:00.000Z", "2026-07-05T05:30:00.000Z", "run:refresh-old", 2),
    );
    await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W28",
        trigger: "cron",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    const late = await claimWorkflowLease(
      {
        runId: "refresh-old",
        acquiredAt: "2026-07-05T06:00:30.000Z",
        idempotencyKey: "run:refresh-old",
        trigger: "workflow",
        allowExistingRun: true,
        now: Date.parse("2026-07-05T06:00:30.000Z"),
      },
      store,
    );
    expect(late.status).toBe("rejected");
    expect(late.lease.run_id).toBe("refresh-new");
  });

  test("late failed release of an old run does not overwrite the successor lease", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-new", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "workflow-refresh:2026-W28", 7),
    );
    expect(await releaseWorkflowLease("refresh-old", "failed", store, "2026-07-05T06:05:00.000Z", 6)).toBe(false);
    expect(store.lease?.run_id).toBe("refresh-new");
    expect(store.lease?.status).toBe("running");
    expect(store.lease?.fencing_token).toBe(7);
  });

  test("two overlapping claims with different keys only one acquires", async () => {
    const store = new MemoryLeaseStore(null, 2);
    const now = Date.parse("2026-07-05T06:00:00.000Z");
    const [a, b] = await Promise.all([
      claimWorkflowLease(
        { runId: "refresh-a", acquiredAt: "2026-07-05T06:00:00.000Z", idempotencyKey: "k-a", trigger: "t", now },
        store,
      ),
      claimWorkflowLease(
        { runId: "refresh-b", acquiredAt: "2026-07-05T06:00:00.000Z", idempotencyKey: "k-b", trigger: "t", now },
        store,
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["acquired", "rejected"]);
    expect(store.lease?.status).toBe("running");
  });
});
