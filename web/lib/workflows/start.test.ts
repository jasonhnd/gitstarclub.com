import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
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
const originalBlobBase = process.env.BLOB_BASE_URL;
const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
const originalGithubToken = process.env.GITHUB_TOKEN;

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  process.env.BLOB_BASE_URL = "https://blob.example.com";
  process.env.BLOB_READ_WRITE_TOKEN = "blob-token";
  process.env.GITHUB_TOKEN = "github-token";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalBlobBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlobBase;
  if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken;
  if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGithubToken;
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

async function passPreflight() {
  return {
    seam_date: "2026-05-30",
    schema_ver: 1,
    folded_through: { month: "2026-05", week: "2026-W22" },
    generated_at: "2026-06-02T14:32:57.214Z",
  };
}

describe("startRefreshWorkflowRoute", () => {
  test.each(["1", "0", "false", "unexpected"])(
    "rejects dry=%s before config checks, lease acquisition, health writes, or enqueue",
    async (dry) => {
      delete process.env.BLOB_BASE_URL;
      delete process.env.BLOB_READ_WRITE_TOKEN;
      delete process.env.GITHUB_TOKEN;
      const store = new MemoryLeaseStore();
      const startWorkflow = mock(async () => {});
      const recordHealth = mock(async () => {});
      const sendAlert = mock(async () => {});

      const response = await startRefreshWorkflowRoute(
        request(`https://gitstarclub.com/api/workflows/refresh/start?dry=${dry}`),
        startWorkflow,
        { leaseStore: store, recordHealth, sendAlert },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        ok: false,
        error: "Managed refresh does not support dry-run. Use the daily or weekly cron dry-run endpoint instead.",
      });
      expect(startWorkflow).not.toHaveBeenCalled();
      expect(recordHealth).not.toHaveBeenCalled();
      expect(sendAlert).not.toHaveBeenCalled();
      expect(store.lease).toBeNull();
    },
  );

  test("rejects unsupported query parameters without acquiring a lease", async () => {
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});

    const response = await startRefreshWorkflowRoute(
      request("https://gitstarclub.com/api/workflows/refresh/start?preview=1"),
      startWorkflow,
      { leaseStore: store, recordHealth: async () => {} },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Unsupported query parameter: preview" });
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(store.lease).toBeNull();
  });

  test("accepts documented trigger and idempotency query parameters", async () => {
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});

    const response = await startRefreshWorkflowRoute(
      request("https://gitstarclub.com/api/workflows/refresh/start?trigger=operator&idempotency_key=manual-2026-07-17"),
      startWorkflow,
      {
        now: new Date("2026-07-17T06:00:00.000Z"),
        leaseStore: store,
        recordHealth: async () => {},
        preflight: passPreflight,
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "started", idempotencyKey: "manual-2026-07-17" });
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(store.lease).toMatchObject({ trigger: "operator", idempotency_key: "manual-2026-07-17" });
  });

  test("fails before acquiring a lease when required runtime config is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await startRefreshWorkflowRoute(request(), startWorkflow, {
        now: new Date("2026-07-05T06:00:00.000Z"),
        leaseStore: store,
        recordHealth: async () => {},
      });

      expect(response.status).toBe(500);
      expect(startWorkflow).not.toHaveBeenCalled();
      expect(store.lease).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("fails canonical preflight before acquiring a lease or enqueueing", async () => {
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await startRefreshWorkflowRoute(request(), startWorkflow, {
        now: new Date("2026-07-05T06:00:00.000Z"),
        leaseStore: store,
        recordHealth: async () => {},
        preflight: async () => {
          throw new Error("canonical schema mismatch");
        },
      });

      expect(response.status).toBe(500);
      expect(startWorkflow).not.toHaveBeenCalled();
      expect(store.lease).toBeNull();
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("two simultaneous route calls do not both enqueue refresh workflows", async () => {
    const store = new MemoryLeaseStore();
    const startWorkflow = mock(async () => {});
    const now = new Date("2026-07-05T06:00:00.000Z");

    const responses = await Promise.all([
      startRefreshWorkflowRoute(request(), startWorkflow, { now, leaseStore: store, recordHealth: async () => {}, preflight: passPreflight }),
      startRefreshWorkflowRoute(request(), startWorkflow, { now, leaseStore: store, recordHealth: async () => {}, preflight: passPreflight }),
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
      preflight: passPreflight,
      recordHealth: async (_pipeline, status, detail) => {
        health.push({ status, detail: detail ?? {} });
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
      preflight: passPreflight,
      recordHealth: async (_pipeline, status, detail) => {
        health.push({ status, detail: detail ?? {} });
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
