import { describe, expect, test } from "bun:test";
import { COMPLETE_RANKING_RENDER_LIMIT, boundedRankItems, hasMoreRankItems } from "./page";

describe("ranking page helpers", () => {
  test("bounds rendered ranking items", () => {
    const items = Array.from({ length: COMPLETE_RANKING_RENDER_LIMIT + 10 }, (_, index) => index);
    expect(boundedRankItems(items)).toHaveLength(COMPLETE_RANKING_RENDER_LIMIT);
  });

  test("detects hidden overflow rows", () => {
    expect(hasMoreRankItems(101, 100)).toBe(true);
    expect(hasMoreRankItems(100, 100)).toBe(false);
  });
});
