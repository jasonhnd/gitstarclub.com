// Unit tests for heatmap derivation (heatmap.ts). A 2-month synthetic site-daily series
// must split into per-month day cells and aggregate into per-year monthly-total cells.
import { test, expect, describe } from "bun:test";
import { heatmaps } from "./heatmap";
import type { DailySeries } from "./model";

const GEN = "2026-06-03T00:00:00Z";

// April (2 days) + May (2 days), all in 2026.
const siteDaily: DailySeries = [
  ["2026-04-10", 5],
  ["2026-04-11", 7],
  ["2026-05-01", 3],
  ["2026-05-02", 10],
];

describe("heatmaps", () => {
  const out = heatmaps(siteDaily, GEN);

  test("emits a month file per distinct month plus a year file", () => {
    expect([...out.keys()].sort()).toEqual([
      "heatmap/month/2026-04.json",
      "heatmap/month/2026-05.json",
      "heatmap/year/2026.json",
    ]);
  });

  test("month file cells = exactly that month's day rows", () => {
    expect(out.get("heatmap/month/2026-04.json")!.cells).toEqual([
      ["2026-04-10", 5],
      ["2026-04-11", 7],
    ]);
    expect(out.get("heatmap/month/2026-05.json")!.cells).toEqual([
      ["2026-05-01", 3],
      ["2026-05-02", 10],
    ]);
  });

  test("month file meta records scope/period/generated_at", () => {
    expect(out.get("heatmap/month/2026-04.json")!.meta).toEqual({
      scope: "month",
      period: "2026-04",
      generated_at: GEN,
    });
  });

  test("year file cells = per-month totals, month-asc", () => {
    // 2026-04 total = 5+7 = 12; 2026-05 total = 3+10 = 13
    expect(out.get("heatmap/year/2026.json")!.cells).toEqual([
      ["2026-04", 12],
      ["2026-05", 13],
    ]);
    expect(out.get("heatmap/year/2026.json")!.meta).toEqual({
      scope: "year",
      period: "2026",
      generated_at: GEN,
    });
  });

  test("year file aggregates months from multiple years separately", () => {
    const multi: DailySeries = [
      ["2025-12-31", 9],
      ["2026-01-01", 4],
      ["2026-01-02", 6],
    ];
    const o = heatmaps(multi, GEN);
    expect(o.get("heatmap/year/2025.json")!.cells).toEqual([["2025-12", 9]]);
    expect(o.get("heatmap/year/2026.json")!.cells).toEqual([["2026-01", 10]]);
  });

  test("empty site-daily produces no files", () => {
    expect(heatmaps([], GEN).size).toBe(0);
  });
});
