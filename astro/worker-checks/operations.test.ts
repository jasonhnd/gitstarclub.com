import { expect, test } from "bun:test";
import { startWorker } from "../scripts/local-worker";
import { fixtureRecords } from "../scripts/fixture";

// Every operation is inside an isolated simulator with synthetic secrets/data.
test("the built Astro entry authenticates shell controls and dispatches Queue/scheduled events", async () => {
  const worker = await startWorker(fixtureRecords(), { CRON_SECRET: "local-fixture-only", WORKFLOW_FIXTURE: "1" });
  try {
    const origin = (await worker.ready).origin;
    for (const [path, method] of [["/start", "GET"], ["/enqueue", "POST"], ["/preview/invalidate", "POST"]]) {
      const response = await fetch(new URL(path, origin), { method });
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized");
    }
    const start = await fetch(new URL("/start", origin), { headers: { authorization: "Bearer local-fixture-only" } });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ ok: true, graph: "fixture", status: "started" });
    // Miniflare's experimental Fetcher methods are documented but its Bun type
    // replacement currently narrows Fetcher to Request. Keep the local shape explicit.
    const entry = await worker.getWorker() as unknown as {
      scheduled(event: { cron: string }): Promise<{ outcome: string }>;
      queue(name: string, messages: { id: string; timestamp: number; attempts: number; body: unknown }[]): Promise<{ outcome: string }>;
    };
    const scheduled = await entry.scheduled({ cron: "0 6 * * SUN" });
    expect(scheduled.outcome).toBe("ok");
    const queued = await entry.queue("astro-local-jobs", [{
      id: "fixture-queue-probe", timestamp: Date.now(), attempts: 1,
      body: { v: 1, graph: "fixture", runId: "local-only", name: "writeViews", attempt: 0, cursor: {} },
    }]);
    expect(queued.outcome).toBe("ok");
    // A failed full job must fail its batch so Cloudflare retains retry behavior.
    const failed = await entry.queue("astro-local-jobs", [{
      id: "fixture-invalid-job", timestamp: Date.now(), attempts: 1,
      body: { v: 1, graph: "full", runId: "local-only", name: "invalid", attempt: 0, cursor: {} },
    }]);
    expect(failed.outcome).not.toBe("ok");
  } finally { await worker.dispose(); }
}, 30_000);

test("built scheduled entry dispatches daily, Sunday weekly and refresh to local authenticated HTTP", async () => {
  const requests: { path: string; method: string; authorization: string | null }[] = [];
  let status = 200;
  const target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    requests.push({ path: new URL(request.url).pathname, method: request.method, authorization: request.headers.get("authorization") });
    return Response.json({ ok: status === 200 }, { status });
  } });
  const worker = await startWorker(fixtureRecords(), {
    CRON_SECRET: "local-scheduled-only", CF_CRON_ORIGIN: target.url.origin, WORKFLOW_FIXTURE: "0",
  });
  try {
    const entry = await worker.getWorker() as unknown as { scheduled(event: { cron: string }): Promise<{ outcome: string }> };
    for (const [cron, path] of [
      ["0 3 * * *", "/api/cron/daily"],
      ["0 4 * * SUN", "/api/cron/weekly"], ["0 4 * * 1", "/api/cron/weekly"],
      ["0 6 * * SUN", "/api/workflows/refresh/start"], ["0 6 * * 1", "/api/workflows/refresh/start"],
    ]) {
      const count = requests.length;
      expect((await entry.scheduled({ cron })).outcome).toBe("ok");
      expect(requests.slice(count)).toEqual([{ path, method: "GET", authorization: "Bearer local-scheduled-only" }]);
    }
    for (const cron of ["0 6 * * 0", "0 6 * * 7", "0 1 * * *"]) {
      expect((await entry.scheduled({ cron })).outcome).not.toBe("ok");
      expect(requests).toHaveLength(5);
    }
    status = 503;
    expect((await entry.scheduled({ cron: "0 3 * * *" })).outcome).not.toBe("ok");
    expect(requests).toHaveLength(6);
  } finally { await worker.dispose(); await target.stop(true); }
}, 30_000);
