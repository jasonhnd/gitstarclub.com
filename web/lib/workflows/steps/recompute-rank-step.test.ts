import { describe, expect, test } from "bun:test";
import { REPO_BUCKETS } from "@/lib/workflows/buckets";
import { nextRefreshJob } from "@/lib/workflows/runtime/graph";
import { rankCarryPath } from "@/lib/workflows/recompute/io";
import { RankList } from "@/lib/contracts";
import { installWorkflowHarness, TEST_RUN, type FullJob } from "../test-support";
import { REST_INGEST_BUCKETS, REST_OFFSET_RANKS, REST_OFFSET_LOOKUP, REST_OFFSET_SEARCH, REST_OFFSET_CATEGORIES } from "./recompute-rest";
import {
  extraRecomputeCheckpointSteps,
  hasNextRecomputeWindow,
  WEEK_RANK_PERIODS_PER_HOP,
  recomputeEnqueuedPath,
  recomputePhaseOf,
  recomputeStartCheckpointName,
  recomputeStepCheckpointName,
} from "./recompute-rank";

describe("recompute rank hops", () => {
  test("names checkpoints by the finer phase list", () => {
    expect(recomputeStepCheckpointName({})).toBe("recomputeRank-month-pack");
    expect(recomputeStepCheckpointName({ recomputePhase: "month", recomputeOffset: 0 })).toBe("recomputeRank-month-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "month", recomputeOffset: 8 })).toBe("recomputeRank-month-8");
    expect(recomputeStepCheckpointName({ recomputePhase: "monthOrg" })).toBe("recomputeRank-monthOrg");
    expect(recomputeStepCheckpointName({ recomputePhase: "monthOrg", recomputeOffset: 0 })).toBe("recomputeRank-monthOrg-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "year" })).toBe("recomputeRank-year-pack");
    expect(recomputeStepCheckpointName({ recomputePhase: "year", recomputeOffset: 0 })).toBe("recomputeRank-year-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "yearOrg", recomputeOffset: 0 })).toBe("recomputeRank-yearOrg-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "week" })).toBe("recomputeRank-week-pack");
    expect(recomputeStepCheckpointName({ recomputePhase: "week", recomputeOffset: 0 })).toBe("recomputeRank-week-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "week", recomputeOffset: 8 })).toBe("recomputeRank-week-8");
    expect(recomputeStepCheckpointName({ recomputePhase: "weekOrg" })).toBe("recomputeRank-weekOrg");
    expect(recomputeStepCheckpointName({ recomputePhase: "weekOrg", recomputeOffset: 0 })).toBe(
      "recomputeRank-weekOrg-0",
    );
    expect(recomputeStepCheckpointName({ recomputePhase: "rest" })).toBe("recomputeRank-rest");
    expect(recomputeStepCheckpointName({ recomputePhase: "rest", recomputeOffset: 0 })).toBe("recomputeRank-rest-0");
    expect(recomputeStepCheckpointName({ recomputePhase: "rest", recomputeOffset: 32 })).toBe("recomputeRank-rest-32");
  });

  test("start markers and fold→recompute enqueue path are stable", () => {
    expect(recomputeStartCheckpointName({})).toBe("recomputeRank-month-start");
    expect(recomputeStartCheckpointName({ recomputePhase: "month", recomputeOffset: 8 })).toBe("recomputeRank-month-8-start");
    expect(recomputeStartCheckpointName({ recomputePhase: "year" })).toBe("recomputeRank-year-start");
    expect(recomputeStartCheckpointName({ recomputePhase: "week" })).toBe("recomputeRank-week-start");
    expect(recomputeEnqueuedPath("refresh-1")).toBe("ops/workflows/refresh-1/recompute-enqueued.json");
  });

  test("recognizes successor fields and terminal checkpoint aliases", () => {
    expect(hasNextRecomputeWindow({ nextRecomputePhase: "monthOrg" })).toBe(true);
    expect(hasNextRecomputeWindow({ nextRecomputePhase: "rest" })).toBe(true);
    expect(hasNextRecomputeWindow({ nextRecomputePhase: "week", nextRecomputeOffset: 0 })).toBe(true);
    expect(hasNextRecomputeWindow({ nextRecomputeOffset: 8 })).toBe(true);
    expect(hasNextRecomputeWindow({ files: 8 })).toBe(false);
    expect(WEEK_RANK_PERIODS_PER_HOP).toBe(8);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "month", recomputeOffset: 16 }, { nextRecomputePhase: "monthOrg", nextRecomputeOffset: 0 })).toEqual([
      "recomputeRank-month",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "monthOrg", recomputeOffset: 8 }, { nextRecomputePhase: "year" })).toEqual([
      "recomputeRank-monthOrg",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "year", recomputeOffset: 8 }, { nextRecomputePhase: "yearOrg", nextRecomputeOffset: 0 })).toEqual([
      "recomputeRank-year",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "yearOrg", recomputeOffset: 0 }, { nextRecomputePhase: "week" })).toEqual([
      "recomputeRank-yearOrg",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "week", recomputeOffset: 16 }, { nextRecomputePhase: "weekOrg", nextRecomputeOffset: 0 })).toEqual([
      "recomputeRank-week",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "weekOrg", recomputeOffset: 8 }, { nextRecomputePhase: "rest", nextRecomputeOffset: 0 })).toEqual([
      "recomputeRank-weekOrg",
    ]);
    expect(extraRecomputeCheckpointSteps({ recomputePhase: "rest", recomputeOffset: 35 }, { files: 8 })).toEqual([
      "recomputeRank-rest",
      "recomputeRank",
    ]);
    expect(recomputePhaseOf({})).toBe("month");
    expect(recomputePhaseOf({ recomputePhase: "yearOrg" })).toBe("yearOrg");
  });

  test("real rank hops read the required families and persist their actual successors", async () => {
    const harness = installWorkflowHarness();
    try {
      const { executeRefreshStep } = await import("../runtime/execute");
      const started = await executeRefreshStep({ v: 1, graph: "full", runId: TEST_RUN, name: "startRun", attempt: 0, cursor: {} });
      let job: FullJob | null = { v: 1, graph: "full", runId: TEST_RUN, name: "recomputeRank", attempt: 0, cursor: { startedAt: started.startedAt, fencingToken: started.fencingToken } };
      const phases: string[] = [];
      const restOffsets: number[] = [];
      let observedCarry = false;
      for (let hops = 0; job?.name === "recomputeRank" && hops < 100; hops++) {
        const phase = job.cursor.recomputePhase ?? "month";
        if (phases.at(-1) !== phase) phases.push(phase);
        if (phase === "rest") restOffsets.push(job.cursor.recomputeOffset ?? 0);
        harness.store.reads.length = 0;
        harness.store.writes.length = 0;
        const { response, result } = await harness.run(job);
        expect(response.status).toBe(200);
        const canonicalReads = harness.store.reads.filter((path) => /^canonical\/v2\/(repos|repo-monthly|repo-weekly|repo-recent-daily)\//.test(path));
        if ((phase === "month" || phase === "week") && job.cursor.recomputeOffset === undefined) {
          const series = phase === "month" ? "repo-monthly" : "repo-weekly";
          expect(new Set(canonicalReads)).toEqual(new Set(Array.from({ length: REPO_BUCKETS }, (_, bucket) => [`canonical/v2/repos/${bucket}.json`, `canonical/v2/${series}/${bucket}.json`]).flat()));
          const metaPath = `ops/workflows/${TEST_RUN}/recompute/${phase}-win/meta.json`;
          const before = harness.store.contents[metaPath];
          // Replay the real pack hop; persisted artifacts are reused unchanged.
          const replay = await harness.run(job);
          expect(replay.result).toEqual(result);
          expect(harness.store.contents[metaPath]).toBe(before);
        } else if (phase === "rest" && (job.cursor.recomputeOffset ?? 0) < REST_INGEST_BUCKETS) {
          const bucket = job.cursor.recomputeOffset ?? 0;
          expect(new Set(canonicalReads)).toEqual(new Set([`canonical/v2/repos/${bucket}.json`]));
          expect(harness.store.writes).toContain(`views/${TEST_RUN}/categories/assignments/shards/${bucket}.json`);
        } else {
          expect(canonicalReads).toEqual([]);
        }
        if (phase === "month" && job.cursor.recomputeOffset === 0) {
          expect(result).toMatchObject({ nextRecomputePhase: "month", nextRecomputeOffset: WEEK_RANK_PERIODS_PER_HOP });
          const carry = harness.store.json(rankCarryPath(TEST_RUN, "month", "repo"));
          expect(carry).toMatchObject({ kind: "month", dim: "repo", nextPeriod: WEEK_RANK_PERIODS_PER_HOP });
          expect(carry.flow).toHaveLength(1000);
          observedCarry = true;
        }
        job = nextRefreshJob(job, result!) as FullJob | null;
      }
      expect(phases).toEqual(["month", "monthOrg", "year", "yearOrg", "week", "weekOrg", "rest"]);
      expect(restOffsets).toEqual([...Array.from({ length: REST_INGEST_BUCKETS }, (_, i) => i), REST_OFFSET_RANKS, REST_OFFSET_LOOKUP, REST_OFFSET_SEARCH, REST_OFFSET_CATEGORIES]);
      expect(job?.name).toBe("recomputeRepoEntities");
      expect(observedCarry).toBe(true);
      const last = RankList.parse(harness.store.json(`views/${TEST_RUN}/rank/month/2026-08/repo/stock.json`));
      expect(last.items[0]).toMatchObject({ rank: 1, id: 1, value: 180, prev_rank: 1 });
      for (const path of ["rank/all-time/repo/stock.json", "lookup/repos.json", "search/index.json", "categories/assignments.json"]) {
        expect(harness.store.contents[`views/${TEST_RUN}/${path}`]).toBeDefined();
      }
    } finally {
      harness.restore();
    }
  }, 30000);
});
