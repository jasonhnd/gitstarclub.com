// Pulse week/month/year/all-time panels open the already-resolved ranking route.
// Row clicks stay on the repo hub; this helper only names the single "full board" exit.

import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import type { Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";

export type PulseBoardKind = "week" | "month" | "year" | "allTime";

export type PulseBoardPeriodSource = Pick<AvailableRankPeriods, "week" | "month" | "yearLink" | "allTime">;

export function pulseBoardHrefs(periods: PulseBoardPeriodSource): Record<PulseBoardKind, string> {
  return {
    week: periods.week.href,
    month: periods.month.href,
    year: periods.yearLink.href,
    allTime: periods.allTime.href,
  };
}

export function localizedPulseBoardHrefs(
  locale: Locale,
  periods: PulseBoardPeriodSource,
): Record<PulseBoardKind, string> {
  const boards = pulseBoardHrefs(periods);
  return {
    week: localizedPath(locale, boards.week),
    month: localizedPath(locale, boards.month),
    year: localizedPath(locale, boards.year),
    allTime: localizedPath(locale, boards.allTime),
  };
}
