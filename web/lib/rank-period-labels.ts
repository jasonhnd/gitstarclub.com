// Shared period labels for Pulse/rankings UI. Pure helpers so unit tests do not need React.

import type {
  AvailableRankFallback,
  AvailableRankPeriods,
  AvailableMonthRankPeriod,
  AvailableWeekRankPeriod,
  AvailableYearRankPeriod,
} from "@/lib/data/rank-periods";
import { monthYearLabel } from "@/lib/format";
import { resolveDataAsOfLabel } from "@/lib/geo-capsules";

export type RankPeriodLabelInput =
  | AvailableMonthRankPeriod
  | AvailableWeekRankPeriod
  | AvailableYearRankPeriod
  | AvailableRankFallback;

export type AvailablePeriodLabelCopy = {
  fullHistory: string;
};

export type PulseListMetaCopy = {
  fullHistory: string;
  latestAvailable: string;
  periodAsOf: string;
};

type CalendarPeriods = {
  year: number;
  month: number;
  week: { year: number; week: number };
};

/** Concrete period label for an available rank window (localized month names). */
export function availablePeriodLabel(
  locale: string,
  period: RankPeriodLabelInput,
  copy: AvailablePeriodLabelCopy,
): string {
  if (period.kind === "month") return monthYearLabel(locale, period.year, period.month);
  if (period.kind === "week") return period.period;
  if (period.kind === "year") return String(period.year);
  return copy.fullHistory;
}

/** True when the resolved week is not the current UTC ISO week (fallback / prior published week). */
export function isFallbackWeekPeriod(
  period: AvailableRankPeriods["week"],
  calendar: Pick<CalendarPeriods, "week">,
): boolean {
  if (period.kind !== "week") return true;
  return period.year !== calendar.week.year || period.week !== calendar.week.week;
}

/** True when the resolved month is not the current UTC calendar month. */
export function isFallbackMonthPeriod(
  period: AvailableRankPeriods["month"],
  calendar: Pick<CalendarPeriods, "year" | "month">,
): boolean {
  if (period.kind !== "month") return true;
  return period.year !== calendar.year || period.month !== calendar.month;
}

/**
 * Visible meta for a Pulse list: actual period, "latest available" when the
 * window fell back, and an optional data-as-of date from precomputed metadata.
 */
export function formatPulseListMeta(options: {
  periodLabel: string;
  isFallback?: boolean;
  asOf?: string | null;
  locale?: string;
  copy: PulseListMetaCopy;
}): string {
  const { periodLabel, isFallback = false, asOf = null, locale = "en", copy } = options;
  const period = isFallback ? fill(copy.latestAvailable, { period: periodLabel }) : periodLabel;
  const asOfLabel = resolveDataAsOfLabel(asOf, { locale });
  if (!asOfLabel) return period;
  return fill(copy.periodAsOf, { period, asOf: asOfLabel });
}

export function periodAsOfCandidate(period: RankPeriodLabelInput): string | null | undefined {
  return "asOf" in period ? period.asOf : undefined;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
