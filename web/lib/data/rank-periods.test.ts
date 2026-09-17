import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RankList } from "@/lib/contracts";
import {
  MONTH_LOOKBACK,
  MONTH_LOOKBACK_CF,
  WEEK_LOOKBACK,
  WEEK_LOOKBACK_CF,
  rankPeriodLookbackLimits,
  resolveAvailableRankPeriodsForTest,
} from "./rank-periods";

const originalHostingTarget = process.env.HOSTING_TARGET;
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  delete process.env.HOSTING_TARGET;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  if (originalHostingTarget === undefined) delete process.env.HOSTING_TARGET;
  else process.env.HOSTING_TARGET = originalHostingTarget;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const NOW_PERIODS = {
  year: 2026,
  month: 7,
  monthPeriod: "2026-07",
  week: { year: 2026, week: 28 },
  weekPeriod: "2026-W28",
};

describe("resolveAvailableRankPeriods", () => {
  test("uses the current ISO week when that rank view exists", async () => {
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => null,
      readRank: rankReader(["2026", "2026-07", "2026-W28"]),
    });

    expect(periods.week).toMatchObject({ kind: "week", year: 2026, week: 28, href: "/rankings/2026/W28" });
  });

  test("falls back to a recent available week when the calendar week is missing", async () => {
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => null,
      readRank: rankReader(["2026", "2026-07", "2026-W26"]),
    });

    expect(periods.week).toMatchObject({ kind: "week", year: 2026, week: 26, href: "/rankings/2026/W26" });
  });

  test("falls back to the previous available month when the calendar month is missing", async () => {
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => null,
      readRank: rankReader(["2026", "2026-06", "2026-W28"]),
    });

    expect(periods.month).toMatchObject({ kind: "month", year: 2026, month: 6, href: "/rankings/2026/6", label: "June 2026" });
  });

  test("uses the newest year as a safe fallback when bounded month and week searches miss", async () => {
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => null,
      readRank: rankReader(["2025"]),
      monthLookback: 2,
      weekLookback: 2,
    });

    expect(periods.year).toBe(2025);
    expect(periods.yearLink).toMatchObject({ kind: "year", href: "/rankings/2025" });
    expect(periods.month).toMatchObject({ kind: "year", href: "/rankings/2025" });
    expect(periods.week).toMatchObject({ kind: "year", href: "/rankings/2025" });
  });

  test("caps month and week lookback to 1 on the CF Workers host", () => {
    expect(rankPeriodLookbackLimits({})).toEqual({ monthLookback: MONTH_LOOKBACK, weekLookback: WEEK_LOOKBACK });
    expect(rankPeriodLookbackLimits({ HOSTING_TARGET: "cf" })).toEqual({
      monthLookback: MONTH_LOOKBACK_CF,
      weekLookback: WEEK_LOOKBACK_CF,
    });
    expect(rankPeriodLookbackLimits({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" })).toEqual({
      monthLookback: MONTH_LOOKBACK,
      weekLookback: WEEK_LOOKBACK,
    });
  });

  test("CF lookback of 1 does not storm missing month and week views", async () => {
    const probed: string[] = [];
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => null,
      readRank: async (window, period) => {
        probed.push(`${window}:${period}`);
        return window === "year" && period === "2026" ? rankFixture(window, period) : null;
      },
      monthLookback: MONTH_LOOKBACK_CF,
      weekLookback: WEEK_LOOKBACK_CF,
    });

    expect(probed.filter((entry) => entry.startsWith("month:"))).toEqual(["month:2026-07"]);
    expect(probed.filter((entry) => entry.startsWith("week:"))).toEqual(["week:2026-W28"]);
    expect(periods.month).toMatchObject({ kind: "year", href: "/rankings/2026" });
    expect(periods.week).toMatchObject({ kind: "year", href: "/rankings/2026" });
  });

  test("uses folded-through periods when bounded calendar fallback misses", async () => {
    const periods = await resolveAvailableRankPeriodsForTest({
      nowPeriods: NOW_PERIODS,
      readMeta: async () => ({ folded_through: { month: "2026-06", week: "2026-W26" } }),
      readRank: rankReader(["2026", "2026-06", "2026-W26"]),
      monthLookback: 1,
      weekLookback: 1,
    });

    expect(periods.month).toMatchObject({ kind: "month", href: "/rankings/2026/6" });
    expect(periods.week).toMatchObject({ kind: "week", href: "/rankings/2026/W26" });
  });
});

function rankReader(availablePeriods: string[]) {
  const available = new Set(availablePeriods);
  return async (window: "year" | "month" | "week", period: string): Promise<RankList | null> =>
    available.has(period) ? rankFixture(window, period) : null;
}

function rankFixture(window: "year" | "month" | "week", period: string): RankList {
  return {
    meta: {
      window,
      period,
      dim: "repo",
      metric: "flow",
      generated_at: GENERATED_AT,
    },
    items: [{ rank: 1, id: 1, value: 100, prev_rank: null }],
  };
}
