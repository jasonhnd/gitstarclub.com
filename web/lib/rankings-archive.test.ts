import { describe, expect, test } from "bun:test";
import { buildArchiveItems } from "@/app/_localized/rankings";

describe("rankings archive items", () => {
  test("lists every tracked year from the year spine", () => {
    const items = buildArchiveItems(
      [
        ["2024", 1_000],
        ["2026", 3_000],
        ["2025", 2_000],
      ],
      {
        year: 2026,
        month: 7,
        monthPeriod: "2026-07",
        week: { year: 2026, week: 27 },
        weekPeriod: "2026-W27",
      },
    );

    expect(items.map((item) => item.href)).toEqual(["/rankings/2026", "/rankings/2025", "/rankings/2024"]);
    expect(items).toHaveLength(3);
    expect(items[0].childrenLinks?.map((link) => link.href)).toContain("/rankings/2026/7");
    expect(items[0].childrenLinks?.map((link) => link.href)).toContain("/rankings/2026/W27");
    expect(items[1].childrenLinks?.map((link) => link.href)).toContain("/rankings/2025/12");
  });
});
