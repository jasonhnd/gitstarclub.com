import { DateStr, WeekPeriod } from "@/lib/contracts/common";
import { StarHistoryProvenance } from "@/lib/contracts/star-history";

/** Select measured gap dates only; never infer provenance from the date alone. */
export function aggregateDailyPoints(points: ReadonlyArray<readonly [string, number]>, provenance: unknown): Array<[string, number]> {
  const parsed = StarHistoryProvenance.safeParse(provenance);
  if (!parsed.success) return [];
  const { start, end_inclusive: end } = parsed.data;
  return points.filter(([day]) => DateStr.safeParse(day).success && day >= start && day <= end)
    .map(([day, count]) => [day, count]);
}

/** Includes both partial edge weeks, but never labels monthly/yearly totals. */
export function hasAggregateWeek(window: string, period: string, provenance: unknown): boolean {
  const parsed = StarHistoryProvenance.safeParse(provenance);
  if (window !== "week" || !parsed.success || !WeekPeriod.safeParse(period).success) return false;
  const year = Number(period.slice(0, 4));
  const week = Number(period.slice(-2));
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(Date.UTC(year, 0, 4 - ((jan4.getUTCDay() + 6) % 7) + (week - 1) * 7));
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  return monday.toISOString().slice(0, 10) <= parsed.data.end_inclusive &&
    sunday.toISOString().slice(0, 10) >= parsed.data.start;
}
