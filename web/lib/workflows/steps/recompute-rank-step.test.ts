import { describe, expect, test } from "bun:test";
import { RECOMPUTE_PHASES } from "@/lib/workflows/runtime/types";
import {
  hasNextRecomputeWindow,
  NEXT_RECOMPUTE_PHASE,
  RECOMPUTE_RANK_FAMILIES,
  recomputeEnqueuedPath,
  recomputePhaseOf,
  recomputeStartCheckpointName,
  recomputeStepCheckpointName,
} from "./recompute-rank";

describe("recompute rank hops", () => {
  test("names checkpoints by the finer phase list", () => {
    expect(recomputeStepCheckpointName({})).toBe("recomputeRank-month");
    expect(recomputeStepCheckpointName({ recomputePhase: "monthOrg" })).toBe("recomputeRank-monthOrg");
    expect(recomputeStepCheckpointName({ recomputePhase: "year" })).toBe("recomputeRank-year");
    expect(recomputeStepCheckpointName({ recomputePhase: "yearOrg" })).toBe("recomputeRank-yearOrg");
    expect(recomputeStepCheckpointName({ recomputePhase: "week" })).toBe("recomputeRank-week");
    expect(recomputeStepCheckpointName({ recomputePhase: "weekOrg" })).toBe("recomputeRank-weekOrg");
    expect(recomputeStepCheckpointName({ recomputePhase: "rest" })).toBe("recomputeRank-rest");
  });

  test("start markers and fold→recompute enqueue path are stable", () => {
    expect(recomputeStartCheckpointName({})).toBe("recomputeRank-month-start");
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
    expect(hasNextRecomputeWindow({ files: 8 })).toBe(false);
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
