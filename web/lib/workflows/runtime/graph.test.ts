import { describe, expect, test } from "bun:test";
import { nextRefreshJob } from "./graph";
import { firstRefreshJob, type RefreshStepJob } from "./types";

function full(name: RefreshStepJob["name"], cursor: RefreshStepJob["cursor"] = {}): Extract<RefreshStepJob, { graph: "full" }> {
  return { v: 1, graph: "full", runId: "refresh-test", name: name as Extract<RefreshStepJob, { graph: "full" }>["name"], attempt: 0, cursor };
}

describe("refresh step graph", () => {
  test("starts a full refresh at startRun", () => {
    expect(firstRefreshJob("refresh-1")).toEqual({
      v: 1,
      graph: "full",
      runId: "refresh-1",
      name: "startRun",
      attempt: 0,
      cursor: {},
    });
  });

  test("walks the full chain and splits metadata by bucket", () => {
    const names: string[] = [];
    let job: RefreshStepJob | null = firstRefreshJob("refresh-1");
    while (job) {
      names.push(job.name === "metadata" ? `metadata-${job.cursor.bucket ?? 0}` : job.name);
      job = nextRefreshJob(job, { name: job.name, startedAt: "2026-09-16T00:00:00.000Z", fencingToken: 2, repos: 1 }, 2);
    }
    expect(names).toEqual([
      "startRun",
      "preflight",
      "whitelist",
      "rename",
      "metadata-0",
      "metadata-1",
      "fold",
      "recomputeRank",
      "recomputeRepoEntities",
      "recomputeOrgEntities",
      "recomputeHeatmap",
      "aliases",
      "validate",
      "publish",
      "gc",
      "markPublished",
    ]);
  });

  test("splits preflight across bucket windows until the last batch", () => {
    const acc = {
      repoRecords: 1,
      monthlyRecords: 1,
      weeklyRecords: 1,
      recentDailyRecords: 1,
      validatedShards: 16,
      schemaFailures: 0,
    };
    const first = nextRefreshJob(full("startRun"), {
      name: "startRun",
      startedAt: "2026-09-20T00:00:00.000Z",
      fencingToken: 3,
    });
    expect(first).toMatchObject({ name: "preflight", cursor: { startedAt: "2026-09-20T00:00:00.000Z", fencingToken: 3 } });
    expect(first?.cursor.preflightOffset).toBeUndefined();

    const mid = nextRefreshJob(first!, {
      name: "preflight",
      nextPreflightOffset: 4,
      preflightAcc: acc,
    });
    expect(mid).toMatchObject({
      name: "preflight",
      cursor: { preflightOffset: 4, preflightAcc: acc, fencingToken: 3 },
    });

    const done = nextRefreshJob(mid!, {
      name: "preflight",
      preflight: { seam_date: "2026-05-30", schema_ver: 1 },
    });
    expect(done).toMatchObject({ name: "whitelist", cursor: { fencingToken: 3 } });
    expect(done?.cursor.preflightOffset).toBeUndefined();
    expect(done?.cursor.preflightAcc).toBeUndefined();
  });

  test("fold windows stay on fold until the last batch", () => {
    const acc = {
      folded: ["2026-08"],
      foldedWeeks: [],
      foldedThroughMonth: "2026-08",
      foldedThroughWeek: "2026-W30",
    };
    const planHop = nextRefreshJob(full("fold", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 }), {
      name: "fold",
      nextFoldPhase: "month",
      nextFoldMonth: "2026-08",
      nextFoldOffset: 0,
      nextFoldSeq: 1,
      foldAcc: acc,
    });
    expect(planHop).toMatchObject({
      name: "fold",
      cursor: { foldPhase: "month", foldMonth: "2026-08", foldOffset: 0, foldSeq: 1, foldAcc: acc },
    });

    const mid = nextRefreshJob(full("fold", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 }), {
      name: "fold",
      nextFoldPhase: "week",
      nextFoldOffset: 1,
      nextFoldSeq: 3,
      foldAcc: acc,
    });
    expect(mid).toMatchObject({
      name: "fold",
      cursor: {
        foldPhase: "week",
        foldOffset: 1,
        foldSeq: 3,
        foldAcc: acc,
        fencingToken: 22,
      },
    });

    const done = nextRefreshJob(mid!, {
      name: "fold",
      folded: ["2026-08"],
      foldedWeeks: ["2026-W31"],
    });
    expect(done).toMatchObject({
      name: "recomputeRank",
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    });
    expect(done?.cursor.foldPhase).toBeUndefined();
    expect(done?.cursor.foldAcc).toBeUndefined();
  });

  test("fold result walks to recomputeRank and keeps the fencing token", () => {
    const next = nextRefreshJob(full("fold", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 }), {
      name: "fold",
      folded: ["2026-08"],
      foldedWeeks: ["2026-W35"],
    });
    expect(next).toMatchObject({
      name: "recomputeRank",
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    });
    expect(next?.cursor.bucket).toBeUndefined();
  });

  test("carries fencing token and startedAt through later jobs", () => {
    const next = nextRefreshJob(full("startRun"), {
      name: "startRun",
      startedAt: "2026-09-16T06:00:00.000Z",
      fencingToken: 9,
    });
    expect(next?.cursor).toEqual({ startedAt: "2026-09-16T06:00:00.000Z", fencingToken: 9 });
  });

  test("fixture graph is the shrink-refresh path", () => {
    const names: string[] = [];
    let job: RefreshStepJob | null = firstRefreshJob("refresh-fixture", "fixture");
    while (job) {
      names.push(job.name);
      job = nextRefreshJob(job, { name: job.name, startedAt: "t", fencingToken: 1 });
    }
    expect(names).toEqual(["startRun", "writeViews", "complete"]);
  });
});
