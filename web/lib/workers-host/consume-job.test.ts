import { describe, expect, test } from "bun:test";
import type { RefreshJob, WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { consumeJob } from "../../../workers/gitstarclub-web/src/shell";
import { QUEUE_ADVANCE_CONSUMER, QUEUE_ADVANCE_HEADER, QUEUE_SUCCESSOR_HEADER } from "./queue-advance";

const STEP = "https://pre.gitstarclub.com/api/workflows/refresh/step";

function foldJob(): RefreshJob {
  return {
    v: 1,
    graph: "full",
    runId: "refresh-2026-09-20T09-39-26-949Z",
    name: "fold",
    attempt: 0,
    cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
  };
}

describe("CF Queue consumeJob successor", () => {
  test("after fold 200, JOBS.send(recomputeRank) and keeps the service-binding isolate alive until the body is read", async () => {
    const queued: RefreshJob[] = [];
    let bodyRead = false;
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch(request) {
          expect(request.headers.get(QUEUE_ADVANCE_HEADER)).toBe(QUEUE_ADVANCE_CONSUMER);
          expect(await request.json()).toMatchObject({ name: "fold", runId: "refresh-2026-09-20T09-39-26-949Z" });
          return new Response(
            JSON.stringify({
              ok: true,
              runId: "refresh-2026-09-20T09-39-26-949Z",
              step: "fold",
              result: { name: "fold", folded: ["2026-08"], foldedWeeks: ["2026-W35"] },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        },
      },
    };

    const originalJson = Response.prototype.json;
    Response.prototype.json = async function json(this: Response) {
      bodyRead = true;
      return originalJson.call(this);
    };
    try {
      await consumeJob(env, foldJob());
    } finally {
      Response.prototype.json = originalJson;
    }

    expect(bodyRead).toBe(true);
    expect(queued).toEqual([
      {
        v: 1,
        graph: "full",
        runId: "refresh-2026-09-20T09-39-26-949Z",
        name: "recomputeRank",
        attempt: 0,
        cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
      },
    ]);
  });

  test("enqueues the monthOrg recompute hop after the month rank window", async () => {
    const queued: RefreshJob[] = [];
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          return Response.json({
            ok: true,
            runId: "refresh-2026-09-20T09-39-26-949Z",
            step: "recomputeRank",
            result: { name: "recomputeRank", files: 12, nextRecomputePhase: "monthOrg" },
          });
        },
      },
    };
    await consumeJob(env, {
      v: 1,
      graph: "full",
      runId: "refresh-2026-09-20T09-39-26-949Z",
      name: "recomputeRank",
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    });
    expect(queued).toMatchObject([{ name: "recomputeRank", cursor: { recomputePhase: "monthOrg" } }]);
  });

  test("enqueues the next week period window after week-pack", async () => {
    const queued: RefreshJob[] = [];
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          return Response.json({
            ok: true,
            runId: "refresh-2026-09-20T09-39-26-949Z",
            step: "recomputeRank",
            result: { name: "recomputeRank", files: 0, nextRecomputePhase: "week", nextRecomputeOffset: 0 },
          });
        },
      },
    };
    await consumeJob(env, {
      v: 1,
      graph: "full",
      runId: "refresh-2026-09-20T09-39-26-949Z",
      name: "recomputeRank",
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22, recomputePhase: "week" },
    });
    expect(queued).toMatchObject([{ name: "recomputeRank", cursor: { recomputePhase: "week", recomputeOffset: 0 } }]);
  });

  test("enqueues the next fold window when fold is not finished", async () => {
    const queued: RefreshJob[] = [];
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          return Response.json({
            ok: true,
            runId: "refresh-2026-09-20T09-39-26-949Z",
            step: "fold",
            result: {
              name: "fold",
              folded: [],
              foldedWeeks: [],
              nextFoldPhase: "month",
              nextFoldMonth: "2026-08",
              nextFoldOffset: 1,
              nextFoldSeq: 1,
              foldAcc: {
                folded: [],
                foldedWeeks: [],
                foldedThroughMonth: "2026-07",
                foldedThroughWeek: "2026-W30",
              },
            },
          });
        },
      },
    };
    await consumeJob(env, foldJob());
    expect(queued).toMatchObject([{ name: "fold", cursor: { foldPhase: "month", foldMonth: "2026-08", foldOffset: 1 } }]);
  });

  test("advances fold → recomputeRank from the successor header when the body is lost to OOM", async () => {
    const queued: RefreshJob[] = [];
    const successor = {
      v: 1 as const,
      graph: "full" as const,
      runId: "refresh-2026-09-20T09-39-26-949Z",
      name: "recomputeRank",
      attempt: 0,
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    };
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          return new Response("Worker exceeded memory limit.", {
            status: 500,
            headers: { [QUEUE_SUCCESSOR_HEADER]: JSON.stringify(successor) },
          });
        },
      },
    };
    await consumeJob(env, foldJob());
    expect(queued).toEqual([successor]);
  });

  test("does not enqueue when the step body is missing and does not treat headers-only 200 as success", async () => {
    const queued: RefreshJob[] = [];
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          return new Response("", { status: 200 });
        },
      },
    };
    await expect(consumeJob(env, foldJob())).rejects.toThrow("non-JSON body");
    expect(queued).toEqual([]);
  });

  test("fixture short-circuit still advances without fetching the step route", async () => {
    const queued: RefreshJob[] = [];
    const env: WorkerEnv = {
      JOBS: { send: async (job) => { queued.push(job); } },
      MEDIA: null,
      WORKFLOW_FIXTURE: "1",
      REFRESH_STEP_URL: STEP,
      CRON_SECRET: "secret",
      WORKER_SELF_REFERENCE: {
        async fetch() {
          throw new Error("fixture consume must not fetch the step route");
        },
      },
    };
    await consumeJob(env, {
      v: 1,
      graph: "fixture",
      runId: "fixture-1",
      name: "startRun",
      attempt: 0,
      cursor: {},
    });
    expect(queued.map((job) => job.name)).toEqual(["writeViews"]);
  });
});
