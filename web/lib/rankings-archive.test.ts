import { describe, expect, test } from "bun:test";
import { buildArchiveItems } from "@/app/_localized/rankings";
import en from "@/lib/i18n/dictionaries/en";
import ja from "@/lib/i18n/dictionaries/ja";

describe("rankings archive items", () => {
  test("lists every tracked year from the year spine", () => {
    const items = buildArchiveItems(
      [
        ["2024", 1_000],
        ["2026", 3_000],
        ["2025", 2_000],
      ],
      availablePeriodsFixture(),
      "en",
      en,
    );

    expect(items.map((item) => item.href)).toEqual(["/rankings/2026", "/rankings/2025", "/rankings/2024"]);
    expect(items).toHaveLength(3);
    expect(items[0].childrenLinks?.map((link) => link.href)).toContain("/rankings/2026/7");
    expect(items[0].childrenLinks?.map((link) => link.href)).toContain("/rankings/2026/W27");
    expect(items[1].childrenLinks?.map((link) => link.href)).toContain("/rankings/2025/12");
  });

  test("localizes archive chrome and compact totals", () => {
    const [item] = buildArchiveItems([["2026", 12_300]], availablePeriodsFixture(), "ja", ja);

    expect(item.description).toBe("年別アーカイブ");
    expect(item.count).toBe("1.2万 スター獲得");
    expect(item.childrenLinks?.map((link) => link.label)).toEqual(["年", "月", "週"]);
  });
});

function availablePeriodsFixture() {
  return {
    year: 2026,
    yearLink: { kind: "year", year: 2026, href: "/rankings/2026", label: "2026" },
    month: { kind: "month", year: 2026, month: 7, period: "2026-07", href: "/rankings/2026/7", label: "July 2026" },
    week: { kind: "week", year: 2026, week: 27, period: "2026-W27", href: "/rankings/2026/W27", label: "2026-W27" },
    allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
  } as const;
}
