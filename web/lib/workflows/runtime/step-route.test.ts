import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { QUEUE_ADVANCE_CONSUMER, QUEUE_ADVANCE_HEADER, QUEUE_SUCCESSOR_HEADER } from "@/lib/workers-host/queue-advance";
import { firstRefreshJob } from "./types";
import { refreshStepCheckpointName, runRefreshStepRoute } from "./step-route";

const originalSecret = process.env.CRON_SECRET;
const originalRuntime = process.env.WORKFLOW_RUNTIME;

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  process.env.WORKFLOW_RUNTIME = "memory";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
  if (originalRuntime === undefined) delete process.env.WORKFLOW_RUNTIME;
  else process.env.WORKFLOW_RUNTIME = originalRuntime;
});

function post(body: unknown, url = "https://gitstarclub.com/api/workflows/refresh/step"): Request {
  return new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("runRefreshStepRoute", () => {
  test("rejects missing bearer tokens", async () => {
    const response = await runRefreshStepRoute(
      new Request("https://gitstarclub.com/api/workflows/refresh/step", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(401);
  });

  test("rejects fixture jobs on the HTTP route", async () => {
    const executeFixture = mock(async () => ({ name: "startRun" }));
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1", "fixture")), {
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "Fixture refresh is not allowed on this runtime" });
    expect(executeFixture).not.toHaveBeenCalled();
  });

  test("executes one full step and completes it", async () => {
    const executeFull = mock(async () => ({ name: "startRun", startedAt: "2026-09-16T00:00:00.000Z", fencingToken: 4 }));
    const complete: string[] = [];
    const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
      kind: "memory",
      executeFull,
      recordCheckpoint: async (job) => {
        complete.push(`checkpoint:${job.name}`);
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "refresh-1", step: "startRun" });
    expect(executeFull).toHaveBeenCalledTimes(1);
    expect(complete).toEqual(["checkpoint:startRun"]);
  });

  test("names preflight checkpoints by bucket window", async () => {
    const names: string[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "preflight" as const,
      attempt: 0,
      cursor: { preflightOffset: 8 },
    };
    expect(refreshStepCheckpointName(job)).toBe("preflight-8");
    const response = await runRefreshStepRoute(post(job), {
      kind: "memory",
      executeFull: async () => ({ name: "preflight", nextPreflightOffset: 12 }),
      recordCheckpoint: async (current) => {
        names.push(refreshStepCheckpointName(current));
      },
    });
    expect(response.status).toBe(200);
    expect(names).toEqual(["preflight-8"]);
  });

  test("names recompute checkpoints by phase", () => {
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: {},
      }),
    ).toBe("recomputeRank-month");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { recomputePhase: "week" },
      }),
    ).toBe("recomputeRank-week");
  });

  test("names fold checkpoints by phase and sequence", () => {
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "fold",
        attempt: 0,
        cursor: { foldPhase: "week", foldSeq: 3 },
      }),
    ).toBe("fold-week-3");
    expect(
      refreshStepCheckpointName({
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "fold",
        attempt: 0,
        cursor: {},
      }),
    ).toBe("fold-month-0");
  });

  test("cf-queue consumer header skips completeStep after fold so the isolate does not POST /enqueue", async () => {
    const enqueues: unknown[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "fold" as const,
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    };
    const headers = {
      authorization: "Bearer secret",
      "content-type": "application/json",
      [QUEUE_ADVANCE_HEADER]: QUEUE_ADVANCE_CONSUMER,
    };
    const response = await runRefreshStepRoute(
      new Request("https://pre.gitstarclub.com/api/workflows/refresh/step", {
        method: "POST",
        headers,
        body: JSON.stringify(job),
      }),
      {
        kind: "cf-queue",
        env: {
          ...process.env,
          CRON_SECRET: "secret",
          WORKFLOW_QUEUE_ENQUEUE_URL: "https://pre.gitstarclub.com/enqueue",
        },
        fetchImpl: async (_url, init) => {
          enqueues.push(JSON.parse(String(init?.body)));
          return new Response("queued", { status: 200 });
        },
        executeFull: async () => ({ name: "fold", folded: ["2026-08"], foldedWeeks: [] }),
        recordCheckpoint: async () => {},
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: "refresh-1", step: "fold" });
    expect(enqueues).toEqual([]);
    expect(JSON.parse(response.headers.get(QUEUE_SUCCESSOR_HEADER) ?? "null")).toMatchObject({
      name: "recomputeRank",
      runId: "refresh-1",
    });
  });

  test("cf-queue direct POST still completeSteps fold → recomputeRank", async () => {
    const enqueues: unknown[] = [];
    const job = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-1",
      name: "fold" as const,
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    };
    const response = await runRefreshStepRoute(post(job), {
      kind: "cf-queue",
      env: {
        ...process.env,
        CRON_SECRET: "secret",
        WORKFLOW_QUEUE_ENQUEUE_URL: "https://pre.gitstarclub.com/enqueue",
      },
      fetchImpl: async (_url, init) => {
        enqueues.push(JSON.parse(String(init?.body)));
        return new Response("queued", { status: 200 });
      },
      executeFull: async () => ({ name: "fold", folded: [], foldedWeeks: [] }),
      recordCheckpoint: async () => {},
    });
    expect(response.status).toBe(200);
    expect(enqueues).toEqual([
      {
        v: 1,
        graph: "full",
        runId: "refresh-1",
        name: "recomputeRank",
        attempt: 0,
        cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
      },
    ]);
  });

  test("records a failed full step after retries are exhausted", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await runRefreshStepRoute(post(firstRefreshJob("refresh-1")), {
        kind: "memory",
        retry: { retries: 0, delaysMs: [] },
        executeFull: async () => {
          throw new Error("boom");
        },
        recordCheckpoint: async () => {},
      });
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ ok: false, runId: "refresh-1" });
    } finally {
      errorSpy.mockRestore();
    }
  });
});
