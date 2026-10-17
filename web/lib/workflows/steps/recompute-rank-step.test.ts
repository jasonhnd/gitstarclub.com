import { describe, expect, test } from "bun:test";
import { RECOMPUTE_PHASES } from "@/lib/workflows/runtime/types";
import {
  extraRecomputeCheckpointSteps,
  hasNextRecomputeWindow,
  NEXT_RECOMPUTE_PHASE,
  RECOMPUTE_RANK_FAMILIES,
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

  test("walks month → monthOrg → year → yearOrg → week → weekOrg → rest", () => {
    let phase: (typeof RECOMPUTE_PHASES)[number] | undefined = "month";
    const seen: string[] = [];
    while (phase) {
      seen.push(phase);
      phase = NEXT_RECOMPUTE_PHASE[phase];
    }
    expect(seen).toEqual(["month", "monthOrg", "year", "yearOrg", "week", "weekOrg", "rest"]);
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

  test("each rank hop still documents only the families it needs", () => {
    expect(RECOMPUTE_RANK_FAMILIES.month).toEqual(["repos", "monthly"]);
    expect(RECOMPUTE_RANK_FAMILIES.monthOrg).toEqual(["repos", "monthly"]);
    expect(RECOMPUTE_RANK_FAMILIES.year).toEqual(["repos", "monthly"]);
    expect(RECOMPUTE_RANK_FAMILIES.week).toEqual(["repos", "weekly"]);
    expect(RECOMPUTE_RANK_FAMILIES.weekOrg).toEqual(["repos", "weekly"]);
    expect(RECOMPUTE_RANK_FAMILIES.rest).toEqual(["repos"]);
  });
});
