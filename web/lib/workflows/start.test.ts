import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import type { HealthStatus } from "@/lib/observability/alert";
import type { WorkflowLeaseSnapshot, WorkflowLeaseStore } from "./lease";
import { startRefreshWorkflowRoute } from "./start";

class MemoryLeaseStore implements WorkflowLeaseStore {
  lease: WorkflowLease | null;
  etag: string | null;
  private version = 0;

  constructor(initial: WorkflowLease | null = null) {
    this.lease = initial ? structuredClone(initial) : null;
    this.etag = initial ? `"${++this.version}"` : null;
  }

  async read(): Promise<WorkflowLeaseSnapshot> {
    return {
      lease: this.lease ? structuredClone(this.lease) : null,
      etag: this.etag,
    };
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

const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

function request(url = "https://gitstarclub.com/api/workflows/refresh/start"): Request {
  return new Request(url, { headers: { authorization: "Bearer secret" } });
}

function runningLease(runId: string, idempotencyKey: string): WorkflowLease {
  return WorkflowLease.parse({
    run_id: runId,
    status: "running",
    acquired_at: "2026-07-05T06:00:00.000Z",
    expires_at: "2026-07-05T18:00:00.000Z",
    idempotency_key: idempotencyKey,
    trigger: "test",
  });
}

describe("startRefreshWorkflowRoute", () => {
  test("two simultaneous route calls do not both enqueue refresh workflows", async () => {
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});
    const now = new Date("2026-07-05T06:00:00.000Z");

    const responses = await Promise.all([
      startRefreshWorkflowRoute(request(), startWorkflow, { now, leaseStore: store, recordHealth: async () => {} }),
      startRefreshWorkflowRoute(request(), startWorkflow, { now, leaseStore: store, recordHealth: async () => {} }),
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ status: string; runId: string }>));

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(bodies.map((body) => body.status).sort()).toEqual(["attached", "started"]);
    expect(new Set(bodies.map((body) => body.runId)).size).toBe(1);
  });

  test("same weekly period retry returns the existing run without enqueueing", async () => {
    const store = new MemoryLeaseStore(runningLease("refresh-existing", "workflow-refresh:2026-W27"));
    const startWorkflow = mock(async () => {});
    const health: Array<{ status: HealthStatus; detail: { run_id?: string; idempotency_key?: string } }> = [];

    const response = await startRefreshWorkflowRoute(request(), startWorkflow, {
      now: new Date("2026-07-05T06:01:00.000Z"),
      leaseStore: store,
      recordHealth: async (_pipeline, status, detail) => {
        health.push({ status, detail });
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "refresh-existing", status: "attached" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(health).toEqual([{ status: "attached", detail: { run_id: "refresh-existing", idempotency_key: "workflow-refresh:2026-W27" } }]);
  });

  test("a different idempotency key is rejected with 409 while a run is active", async () => {
    const store = new MemoryLeaseStore(runningLease("refresh-existing", "workflow-refresh:2026-W27"));
    const startWorkflow = mock(async () => {});
    const health: Array<{ status: HealthStatus; detail: { run_id?: string; idempotency_key?: string; error?: string } }> = [];

    const response = await startRefreshWorkflowRoute(request("https://gitstarclub.com/api/workflows/refresh/start?idempotency_key=manual-1"), startWorkflow, {
      now: new Date("2026-07-05T06:01:00.000Z"),
      leaseStore: store,
      recordHealth: async (_pipeline, status, detail) => {
        health.push({ status, detail });
      },
    });

    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toMatchObject({ ok: false, runId: "refresh-existing", status: "rejected" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(health[0]?.status).toBe("rejected");
    expect(health[0]?.detail.idempotency_key).toBe("manual-1");
  });
});
