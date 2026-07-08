import { cache } from "react";
import type { RankList } from "@/lib/contracts";
import { monthYearLabel } from "@/lib/format";
import { currentUtcPeriods, FIRST_YEAR, isoWeek } from "@/lib/periods";
import { getMeta } from "./meta";
import { getRank } from "./rank";

type RankWindow = "year" | "month" | "week";
type RankReader = (window: RankWindow, period: string, dim: "repo", metric: "flow") => Promise<RankList | null>;
type MetaReader = () => Promise<{ folded_through?: { month: string; week: string } } | null>;
type MonthPeriodKey = { year: number; month: number };
type WeekPeriodKey = { year: number; week: number };

export type AvailableRankFallback = {
  kind: "fallback";
  href: string;
  label: string;
  asOf?: string;
};

export type AvailableYearRankPeriod = {
  kind: "year";
  year: number;
  href: string;
  label: string;
  asOf?: string;
};

export type AvailableMonthRankPeriod = {
  kind: "month";
  year: number;
  month: number;
  period: string;
  href: string;
  label: string;
  asOf?: string;
};

export type AvailableWeekRankPeriod = {
  kind: "week";
  year: number;
  week: number;
  period: string;
  href: string;
  label: string;
  asOf?: string;
};

export type AvailableRankPeriods = {
  year: number;
  yearLink: AvailableYearRankPeriod | AvailableRankFallback;
  month: AvailableMonthRankPeriod | AvailableYearRankPeriod | AvailableRankFallback;
  week: AvailableWeekRankPeriod | AvailableYearRankPeriod | AvailableRankFallback;
  allTime: { kind: "all-time"; href: string; label: string };
};

type ResolveOptions = {
  now?: Date;
  readRank?: RankReader;
  readMeta?: MetaReader;
  monthLookback?: number;
  weekLookback?: number;
};

const MONTH_LOOKBACK = 18;
const WEEK_LOOKBACK = 12;

export function resolveAvailableRankPeriods(now = new Date()): Promise<AvailableRankPeriods> {
  const cacheKey = process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "";
  return resolveAvailableRankPeriodsCached(now.toISOString().slice(0, 10), cacheKey);
}

const resolveAvailableRankPeriodsCached = cache((isoDate: string, cacheKey: string) => {
  void cacheKey;
  return resolveAvailableRankPeriodsForTest({ now: new Date(`${isoDate}T12:00:00.000Z`) });
});

export async function resolveAvailableRankPeriodsForTest({
  now = new Date(),
  readRank = getRank as RankReader,
  readMeta = getMeta as MetaReader,
  monthLookback = MONTH_LOOKBACK,
  weekLookback = WEEK_LOOKBACK,
}: ResolveOptions = {}): Promise<AvailableRankPeriods> {
  const current = currentUtcPeriods(now);
  const meta = await readMeta();
  const foldedMonth = parseMonthPeriod(meta?.folded_through?.month);
  const foldedWeek = parseWeekPeriod(meta?.folded_through?.week);
  const year = await findLatestYear(current.year, readRank);
  const yearLink = year ? yearRankPeriod(year.year, year.rank.meta.generated_at) : fallbackAllTime();
  const fallback = year ? yearRankPeriod(year.year, year.rank.meta.generated_at) : fallbackAllTime();
  const monthStart = { year: current.year, month: current.month };
  const weekStart = current.week;

  const [boundedMonth, boundedWeek] = await Promise.all([
    findLatestMonth(monthStart, readRank, monthLookback),
    findLatestWeek(weekStart, readRank, weekLookback),
  ]);
  const [foldedMonthRank, foldedWeekRank] = await Promise.all([
    boundedMonth || !foldedMonth ? Promise.resolve(null) : findLatestMonth(foldedMonth, readRank, 1),
    boundedWeek || !foldedWeek ? Promise.resolve(null) : findLatestWeek(foldedWeek, readRank, 1),
  ]);
  const month = boundedMonth ?? foldedMonthRank;
  const week = boundedWeek ?? foldedWeekRank;

  return {
    year: year?.year ?? current.year,
    yearLink,
    month: month ?? fallback,
    week: week ?? fallback,
    allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
  };
}

export async function resolveAdjacentRankYear(year: number, direction: -1 | 1): Promise<AvailableYearRankPeriod | null> {
  const latest = await resolveAvailableRankPeriods();
  for (let candidate = year + direction; candidate >= FIRST_YEAR && candidate <= latest.year; candidate += direction) {
    const rank = await getRank("year", String(candidate), "repo", "flow");
    if (rank) return yearRankPeriod(candidate, rank.meta.generated_at);
  }
  return null;
}

export async function resolveAdjacentRankPeriod(
  window: "month",
  current: { year: number; month: number },
  direction: -1 | 1,
): Promise<AvailableMonthRankPeriod | null>;
export async function resolveAdjacentRankPeriod(
  window: "week",
  current: { year: number; week: number },
  direction: -1 | 1,
): Promise<AvailableWeekRankPeriod | null>;
export async function resolveAdjacentRankPeriod(
  window: "month" | "week",
  current: { year: number; month?: number; week?: number },
  direction: -1 | 1,
): Promise<AvailableMonthRankPeriod | AvailableWeekRankPeriod | null> {
  const latest = await resolveAvailableRankPeriods();
  if (window === "month") {
    if (current.month == null) return null;
    const latestMonth = latest.month.kind === "month" ? latest.month : null;
    let candidate: MonthPeriodKey | null | undefined = shiftMonth(current.year, current.month, direction);
    for (let step = 0; candidate && step < MONTH_LOOKBACK && candidate.year >= FIRST_YEAR; step++) {
      if (direction > 0 && (!latestMonth || compareMonths(candidate, latestMonth) > 0)) return null;
      const rank = await getRank("month", formatMonthPeriod(candidate.year, candidate.month), "repo", "flow");
      if (rank) return monthRankPeriod(candidate.year, candidate.month, rank.meta.generated_at);
      candidate = shiftMonth(candidate.year, candidate.month, direction);
    }
    return null;
  }

  if (current.week == null) return null;
  const latestWeek = latest.week.kind === "week" ? latest.week : null;
  let candidate: WeekPeriodKey | null | undefined = shiftIsoWeek(current.year, current.week, direction);
  for (let step = 0; candidate && step < WEEK_LOOKBACK && candidate.year >= FIRST_YEAR; step++) {
    if (direction > 0 && (!latestWeek || compareIsoWeeks(candidate, latestWeek) > 0)) return null;
    const rank = await getRank("week", formatWeekPeriod(candidate.year, candidate.week), "repo", "flow");
    if (rank) return weekRankPeriod(candidate.year, candidate.week, rank.meta.generated_at);
    candidate = shiftIsoWeek(candidate.year, candidate.week, direction);
  }
  return null;
}

async function findLatestYear(startYear: number, readRank: RankReader): Promise<{ year: number; rank: RankList } | null> {
  for (let year = startYear; year >= FIRST_YEAR; year--) {
    const rank = await readRank("year", String(year), "repo", "flow");
    if (rank) return { year, rank };
  }
  return null;
}

async function findLatestMonth(
  start: MonthPeriodKey | null | undefined,
  readRank: RankReader,
  maxSteps: number,
): Promise<AvailableMonthRankPeriod | null> {
  let candidate = start;
  for (let step = 0; candidate && step < maxSteps && candidate.year >= FIRST_YEAR; step++) {
    const rank = await readRank("month", formatMonthPeriod(candidate.year, candidate.month), "repo", "flow");
    if (rank) return monthRankPeriod(candidate.year, candidate.month, rank.meta.generated_at);
    candidate = shiftMonth(candidate.year, candidate.month, -1);
  }
  return null;
}

async function findLatestWeek(
  start: WeekPeriodKey | null | undefined,
  readRank: RankReader,
  maxSteps: number,
): Promise<AvailableWeekRankPeriod | null> {
  let candidate = start;
  for (let step = 0; candidate && step < maxSteps && candidate.year >= FIRST_YEAR; step++) {
    const rank = await readRank("week", formatWeekPeriod(candidate.year, candidate.week), "repo", "flow");
    if (rank) return weekRankPeriod(candidate.year, candidate.week, rank.meta.generated_at);
    candidate = shiftIsoWeek(candidate.year, candidate.week, -1);
  }
  return null;
}

function yearRankPeriod(year: number, asOf?: string): AvailableYearRankPeriod {
  return { kind: "year", year, href: `/rankings/${year}`, label: String(year), asOf };
}

function monthRankPeriod(year: number, month: number, asOf?: string): AvailableMonthRankPeriod {
  return {
    kind: "month",
    year,
    month,
    period: formatMonthPeriod(year, month),
    href: `/rankings/${year}/${month}`,
    label: monthYearLabel("en", year, month),
    asOf,
  };
}

function weekRankPeriod(year: number, week: number, asOf?: string): AvailableWeekRankPeriod {
  const period = formatWeekPeriod(year, week);
  return { kind: "week", year, week, period, href: `/rankings/${year}/W${String(week).padStart(2, "0")}`, label: period, asOf };
}

function fallbackAllTime(): AvailableRankFallback {
  return { kind: "fallback", href: "/rankings", label: "Full history" };
}

function parseMonthPeriod(value: string | undefined): { year: number; month: number } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value ?? "");
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseWeekPeriod(value: string | undefined): { year: number; week: number } | null {
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value ?? "");
  if (!match) return null;
  return { year: Number(match[1]), week: Number(match[2]) };
}

function formatMonthPeriod(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatWeekPeriod(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function shiftIsoWeek(year: number, week: number, delta: number): { year: number; week: number } {
  const date = isoWeekStartDate(year, week);
  date.setUTCDate(date.getUTCDate() + delta * 7);
  return isoWeek(date);
}

function compareMonths(a: { year: number; month: number }, b: { year: number; month: number }): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

function compareIsoWeeks(a: { year: number; week: number }, b: { year: number; week: number }): number {
  return isoWeekStartDate(a.year, a.week).getTime() - isoWeekStartDate(b.year, b.week).getTime();
}

function isoWeekStartDate(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  jan4.setUTCDate(jan4.getUTCDate() + 1 - day + (week - 1) * 7);
  return jan4;
}
