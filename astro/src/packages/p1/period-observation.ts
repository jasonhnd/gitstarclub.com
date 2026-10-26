import type { CurrentMonth, Heatmap } from "../../../../web/lib/contracts";
import { isRankingPeriod } from "../../../../web/lib/public-params";
import { isoWeek } from "../../../../web/lib/periods";

type PeriodWindow = "week" | "month";
type PublishedObservations = {
  currentMonth: Pick<CurrentMonth, "month" | "daily_totals"> | null | undefined;
  heat?: Pick<Heatmap, "cells"> | null;
};

/** First published day inside the period; admissions and the gross/net seam do not describe coverage. */
export function partialPeriodObservationStart(
  window: PeriodWindow,
  period: string,
  { currentMonth, heat }: PublishedObservations,
): string | null {
  if (!isRankingPeriod(window, period)) return null;
  // Only the open month's daily series can establish weekly coverage. Older
  // months use their own heatmap, never a repository's discovery date.
  const cells = window === "week" || currentMonth?.month === period
    ? currentMonth?.daily_totals
    : !currentMonth || period < currentMonth.month ? heat?.cells : undefined;
  let first: string | null = null;
  for (const [day] of cells ?? []) {
    const date = new Date(`${day}T00:00:00.000Z`);
    const week = window === "week" ? isoWeek(date) : null;
    const inPeriod = week
      ? `${week.year}-W${String(week.week).padStart(2, "0")}` === period
      : day.slice(0, 7) === period;
    if (inPeriod && (first === null || day < first)) first = day;
  }
  if (first === null) return null;
  const startsOnFirstDay = window === "month"
    ? first === `${period}-01`
    : new Date(`${first}T00:00:00.000Z`).getUTCDay() === 1;
  return startsOnFirstDay ? null : first;
}
