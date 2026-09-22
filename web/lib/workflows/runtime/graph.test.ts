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
      placeholderShards: 0,
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

  test("metadata GraphQL 502 keeps the same bucket hop", () => {
    const job = full("metadata", { startedAt: "2026-09-21T16:02:55.723Z", fencingToken: 30, bucket: 0 });
    const retry = nextRefreshJob(job, {
      name: "metadata",
      retryMetadata: true,
      bucket: 0,
      repos: 100,
      from_github: 100,
      error: "GitHub GraphQL 502: error code: 502",
    });
    expect(retry).toMatchObject({
      name: "metadata",
      cursor: { bucket: 0, fencingToken: 30, startedAt: "2026-09-21T16:02:55.723Z" },
    });
    expect(retry?.cursor.metadata).toBeUndefined();

    const advanced = nextRefreshJob(job, { name: "metadata", bucket: 0, repos: 100, from_github: 100 });
    expect(advanced).toMatchObject({ name: "metadata", cursor: { bucket: 1, fencingToken: 30 } });
  });

  test("whitelist Search hops stay on whitelist until the last shard", () => {
    const mid = nextRefreshJob(full("whitelist", { startedAt: "2026-09-21T14:05:09.247Z", fencingToken: 29 }), {
      name: "whitelist",
      nextWhitelistSearchSeq: 1,
      count: 20_000,
    });
    expect(mid).toMatchObject({
      name: "whitelist",
      cursor: { whitelistSearchSeq: 1, fencingToken: 29 },
    });

    const done = nextRefreshJob(mid!, {
      name: "whitelist",
      count: 65_014,
      added: 59_480,
      dropped: 0,
    });
    expect(done).toMatchObject({
      name: "rename",
      cursor: { startedAt: "2026-09-21T14:05:09.247Z", fencingToken: 29 },
    });
    expect(done?.cursor.whitelistSearchSeq).toBeUndefined();
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

  test("recomputeRank stays on recompute until the rest hop finishes", () => {
    const month = nextRefreshJob(full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 }), {
      name: "recomputeRank",
      files: 10,
      nextRecomputePhase: "monthOrg",
    });
    expect(month).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "monthOrg", fencingToken: 22 },
    });

    const year = nextRefreshJob(month!, {
      name: "recomputeRank",
      files: 4,
      nextRecomputePhase: "year",
    });
    expect(year).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "year", fencingToken: 22 },
    });

    const rest = nextRefreshJob(
      full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22, recomputePhase: "weekOrg" }),
      { name: "recomputeRank", files: 3, nextRecomputePhase: "rest" },
    );
    expect(rest).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "rest", fencingToken: 22 },
    });

    const done = nextRefreshJob(rest!, { name: "recomputeRank", files: 8 });
    expect(done).toMatchObject({
      name: "recomputeRepoEntities",
      cursor: { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 },
    });
    expect(done?.cursor.recomputePhase).toBeUndefined();
    expect(done?.cursor.recomputeOffset).toBeUndefined();
  });

  test("recomputeRank week pack and period windows stay on recomputeRank", () => {
    const pack = nextRefreshJob(full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22, recomputePhase: "week" }), {
      name: "recomputeRank",
      files: 0,
      nextRecomputePhase: "week",
      nextRecomputeOffset: 0,
    });
    expect(pack).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "week", recomputeOffset: 0, fencingToken: 22 },
    });

    const mid = nextRefreshJob(pack!, {
      name: "recomputeRank",
      files: 16,
      nextRecomputePhase: "week",
      nextRecomputeOffset: 8,
    });
    expect(mid).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "week", recomputeOffset: 8, fencingToken: 22 },
    });

    const toOrg = nextRefreshJob(mid!, {
      name: "recomputeRank",
      files: 4,
      nextRecomputePhase: "weekOrg",
      nextRecomputeOffset: 0,
    });
    expect(toOrg).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "weekOrg", recomputeOffset: 0, fencingToken: 22 },
    });
  });

  test("recomputeRank month pack, year derive, and rest buckets stay on recomputeRank", () => {
    const monthPack = nextRefreshJob(full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22 }), {
      name: "recomputeRank",
      files: 2,
      nextRecomputePhase: "month",
      nextRecomputeOffset: 0,
    });
    expect(monthPack).toMatchObject({
      name: "recomputeRank",
      cursor: { recomputePhase: "month", recomputeOffset: 0, fencingToken: 22 },
    });

    const yearPack = nextRefreshJob(full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22, recomputePhase: "year" }), {
      name: "recomputeRank",
      files: 1,
      nextRecomputePhase: "year",
      nextRecomputeOffset: 0,
    });
    expect(yearPack).toMatchObject({
      cursor: { recomputePhase: "year", recomputeOffset: 0 },
    });

    const rest = nextRefreshJob(
      full("recomputeRank", { startedAt: "2026-09-20T09:39:26.949Z", fencingToken: 22, recomputePhase: "weekOrg", recomputeOffset: 8 }),
      { name: "recomputeRank", files: 1, nextRecomputePhase: "rest", nextRecomputeOffset: 0 },
    );
    expect(rest).toMatchObject({
      cursor: { recomputePhase: "rest", recomputeOffset: 0, fencingToken: 22 },
    });

    const restNext = nextRefreshJob(rest!, { name: "recomputeRank", files: 1, nextRecomputePhase: "rest", nextRecomputeOffset: 1 });
    expect(restNext).toMatchObject({ cursor: { recomputePhase: "rest", recomputeOffset: 1 } });
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
