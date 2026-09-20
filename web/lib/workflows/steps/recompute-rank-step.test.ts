import { describe, expect, test } from "bun:test";
import { hasNextRecomputeWindow, RECOMPUTE_RANK_FAMILIES, recomputeStepCheckpointName } from "./recompute-rank";

describe("recompute rank hops", () => {
  test("names checkpoints by phase", () => {
    expect(recomputeStepCheckpointName({})).toBe("recomputeRank-month");
    expect(recomputeStepCheckpointName({ recomputePhase: "week" })).toBe("recomputeRank-week");
    expect(recomputeStepCheckpointName({ recomputePhase: "rest" })).toBe("recomputeRank-rest");
  });

  test("hasNextRecomputeWindow is true only while a rank hop remains", () => {
    expect(hasNextRecomputeWindow({ nextRecomputePhase: "week" })).toBe(true);
    expect(hasNextRecomputeWindow({ nextRecomputePhase: "rest" })).toBe(true);
    expect(hasNextRecomputeWindow({ files: 8 })).toBe(false);
  });

  test("each rank hop loads only the families it needs", () => {
    expect(RECOMPUTE_RANK_FAMILIES.month).toEqual(["repos", "monthly"]);
    expect(RECOMPUTE_RANK_FAMILIES.week).toEqual(["repos", "weekly"]);
    expect(RECOMPUTE_RANK_FAMILIES.rest).toEqual(["repos"]);
  });
});
