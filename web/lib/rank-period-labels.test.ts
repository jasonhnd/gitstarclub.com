import { describe, expect, test } from "bun:test";
import {
  availablePeriodLabel,
  formatPulseListMeta,
  isFallbackMonthPeriod,
  isFallbackWeekPeriod,
  periodAsOfCandidate,
} from "./rank-period-labels";

const copy = {
  fullHistory: "Full history",
  latestAvailable: "Latest available: {period}",
  periodAsOf: "{period} · as of {asOf}",
};

const calendar = {
  year: 2026,
  month: 8,
  week: { year: 2026, week: 33 },
};

describe("availablePeriodLabel", () => {
  test("labels week, month, year, and full-history fallback periods", () => {
    expect(
      availablePeriodLabel("en", { kind: "week", year: 2026, week: 26, period: "2026-W26", href: "/rankings/2026/W26", label: "2026-W26" }, copy),
    ).toBe("2026-W26");
    expect(
      availablePeriodLabel(
        "en",
        { kind: "month", year: 2026, month: 6, period: "2026-06", href: "/rankings/2026/6", label: "June 2026" },
        copy,
      ),
    ).toBe("June 2026");
    expect(availablePeriodLabel("ja", { kind: "month", year: 2026, month: 6, period: "2026-06", href: "/rankings/2026/6", label: "June 2026" }, copy)).toBe(
      "2026年6月",
    );
    expect(availablePeriodLabel("en", { kind: "year", year: 2025, href: "/rankings/2025", label: "2025" }, copy)).toBe("2025");
    expect(availablePeriodLabel("en", { kind: "fallback", href: "/rankings", label: "Full history" }, copy)).toBe("Full history");
  });
});

describe("fallback period detection", () => {
  test("marks non-current and non-week kinds as fallback weeks", () => {
    expect(
      isFallbackWeekPeriod(
        { kind: "week", year: 2026, week: 33, period: "2026-W33", href: "/rankings/2026/W33", label: "2026-W33" },
        calendar,
      ),
    ).toBe(false);
    expect(
      isFallbackWeekPeriod(
        { kind: "week", year: 2026, week: 26, period: "2026-W26", href: "/rankings/2026/W26", label: "2026-W26" },
        calendar,
      ),
    ).toBe(true);
    expect(isFallbackWeekPeriod({ kind: "year", year: 2025, href: "/rankings/2025", label: "2025" }, calendar)).toBe(true);
    expect(isFallbackWeekPeriod({ kind: "fallback", href: "/rankings", label: "Full history" }, calendar)).toBe(true);
  });

  test("marks non-current and non-month kinds as fallback months", () => {
    expect(
      isFallbackMonthPeriod(
        { kind: "month", year: 2026, month: 8, period: "2026-08", href: "/rankings/2026/8", label: "August 2026" },
        calendar,
      ),
    ).toBe(false);
    expect(
      isFallbackMonthPeriod(
        { kind: "month", year: 2026, month: 6, period: "2026-06", href: "/rankings/2026/6", label: "June 2026" },
        calendar,
      ),
    ).toBe(true);
    expect(isFallbackMonthPeriod({ kind: "year", year: 2025, href: "/rankings/2025", label: "2025" }, calendar)).toBe(true);
  });
});

describe("formatPulseListMeta", () => {
  test("states the actual period without a latest-available prefix for current windows", () => {
    expect(
      formatPulseListMeta({
        periodLabel: "2026-W33",
        isFallback: false,
        copy,
      }),
    ).toBe("2026-W33");
  });

  test("labels fallback weeks as latest available", () => {
    expect(
      formatPulseListMeta({
        periodLabel: "2026-W26",
        isFallback: true,
        copy,
      }),
    ).toBe("Latest available: 2026-W26");
  });

  test("appends a localized as-of date from precomputed metadata", () => {
    expect(
      formatPulseListMeta({
        periodLabel: "2026-W26",
        isFallback: true,
        asOf: "2026-06-21T00:00:00.000Z",
        locale: "en",
        copy,
      }),
    ).toBe("Latest available: 2026-W26 · as of June 21, 2026");
  });

  test("snapshots all-time and on-this-day style metas", () => {
    expect(
      formatPulseListMeta({
        periodLabel: "Full history",
        asOf: "2026-06-24T12:00:00Z",
        locale: "en",
        copy,
      }),
    ).toBe("Full history · as of June 24, 2026");
    expect(
      formatPulseListMeta({
        periodLabel: "August 16, 2026",
        asOf: "2026-08-16T00:00:00Z",
        locale: "en",
        copy,
      }),
    ).toBe("August 16, 2026 · as of August 16, 2026");
  });

  test("ignores non-date as-of candidates", () => {
    expect(
      formatPulseListMeta({
        periodLabel: "2025",
        asOf: "fallback",
        copy,
      }),
    ).toBe("2025");
  });
});

describe("periodAsOfCandidate", () => {
  test("reads optional asOf from available period objects", () => {
    expect(periodAsOfCandidate({ kind: "fallback", href: "/rankings", label: "Full history" })).toBeUndefined();
    expect(
      periodAsOfCandidate({
        kind: "week",
        year: 2026,
        week: 26,
        period: "2026-W26",
        href: "/rankings/2026/W26",
        label: "2026-W26",
        asOf: "2026-06-21T00:00:00.000Z",
      }),
    ).toBe("2026-06-21T00:00:00.000Z");
  });
});
