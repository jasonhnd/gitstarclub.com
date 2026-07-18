import { describe, expect, test } from "bun:test";
import { isoWeekDays, topWeekFlowItems } from "./backfill-live-week";

describe("backfill-live-week helpers", () => {
  test("isoWeekDays returns Mon–Sun for 2026-W27", () => {
    expect(isoWeekDays("2026-W27")).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  test("topWeekFlowItems ranks by value descending and caps at topN", () => {
    const counts = new Map<number, number>([
      [1, 10],
      [2, 50],
      [3, 0],
      [4, 50],
      [5, 1],
    ]);
    const items = topWeekFlowItems(counts, 3);
    expect(items).toEqual([
      { rank: 1, id: 2, value: 50, prev_rank: null },
      { rank: 2, id: 4, value: 50, prev_rank: null },
      { rank: 3, id: 1, value: 10, prev_rank: null },
    ]);
  });
});
