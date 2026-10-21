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
