import { describe, expect, test } from "bun:test";
import { CURRENT_MONTH_SHARD_COUNT, CurrentMonth, CurrentMonthIndex } from "@/lib/contracts";
import {
  assembleCurrentMonth,
  currentMonthPublicationArtifacts,
  currentMonthShardPath,
  isCurrentMonthIndex,
  splitCurrentMonth,
} from "@/lib/data/current-month-shards";

const month = CurrentMonth.parse({
  month: "2026-08",
  updated: "2026-08-23",
  daily_totals: [["2026-08-01", 10], ["2026-08-23", 4]],
  per_repo: {
    "1": [["2026-08-01", 2]],
    "32": [["2026-08-23", 1]],
    "33": [["2026-08-23", 1]],
  },
  current_stars: { "1": 100, "32": 200, "33": 300 },
});

describe("current_month shards", () => {
  test("round-trips through index + 32 shards and keeps bucket membership", () => {
    const { index, shards } = splitCurrentMonth(month);
    expect(index.shard_count).toBe(CURRENT_MONTH_SHARD_COUNT);
    expect(shards).toHaveLength(CURRENT_MONTH_SHARD_COUNT);
    expect(shards[1]?.data.per_repo["1"]).toEqual([["2026-08-01", 2]]);
    expect(shards[1]?.data.per_repo["33"]).toEqual([["2026-08-23", 1]]);
    expect(shards[0]?.data.per_repo["32"]).toEqual([["2026-08-23", 1]]);
    expect(assembleCurrentMonth(index, shards.map((shard) => shard.data))).toEqual(month);
  });

  test("publication artifacts write a small index at current_month.json", () => {
    const artifacts = currentMonthPublicationArtifacts(month);
    expect(artifacts[0]?.path).toBe("current_month.json");
    expect(isCurrentMonthIndex(artifacts[0]?.data)).toBe(true);
    expect(CurrentMonthIndex.parse(artifacts[0]?.data).daily_totals).toHaveLength(2);
    expect(artifacts.some((item) => item.path === currentMonthShardPath(0))).toBe(true);
    expect("per_repo" in (artifacts[0]?.data as object)).toBe(false);
  });

  test("rejects a missing shard instead of silently dropping repos", () => {
    const { index, shards } = splitCurrentMonth(month);
    expect(() => assembleCurrentMonth(index, shards.slice(1).map((shard) => shard.data))).toThrow(
      /expected 32 shards, received 31|missing shard/,
    );
  });
});
