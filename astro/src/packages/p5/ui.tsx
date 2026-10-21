import type { Dict, Locale } from "@/lib/i18n";
import type { PeriodSwitcherTarget } from "@/app/_explore/PeriodSwitcher";
import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import { currentUtcPeriods } from "@/lib/periods";
import { availablePeriodLabel, isFallbackMonthPeriod, isFallbackWeekPeriod } from "@/lib/rank-period-labels";
import { fill } from "../../../../web/app/_localized/detail-copy";

// Preserve the existing UI helpers without importing unrelated Next route parsers.
export function EmptyState({ message, className = "", variant = "overview" }: { message: string; className?: string; variant?: "overview" | "detail" }) {
  const shape = variant === "detail" ? "rounded-lg" : "mt-[clamp(1rem,2vw,1.5rem)] rounded-2xl";
  return (
    <p className={`${shape} border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>
      {message}
    </p>
  );
}

export function periodSwitcherLinks(
  periods: AvailableRankPeriods,
  calendar: ReturnType<typeof currentUtcPeriods>,
  href: (path: string) => string,
  locale: Locale,
  t: Dict,
): Record<"all-time" | "year" | "month" | "week", PeriodSwitcherTarget> {
  const labelCopy = { fullHistory: t.rankings.fullHistory };
  return {
    "all-time": { href: href(periods.allTime.href), label: t.rankings.allTime, value: t.rankings.fullHistory },
    year: { href: href(periods.yearLink.href), label: t.year.label, value: availablePeriodLabel(locale, periods.yearLink, labelCopy) },
    month: {
      href: href(periods.month.href),
      label: t.month.label,
      value: availablePeriodLabel(locale, periods.month, labelCopy),
      badge: isFallbackMonthPeriod(periods.month, calendar)
        ? fill(t.common.latestAvailable, { period: availablePeriodLabel(locale, periods.month, labelCopy) })
        : undefined,
    },
    week: {
      href: href(periods.week.href),
      label: t.week.label,
      value: availablePeriodLabel(locale, periods.week, labelCopy),
      badge: isFallbackWeekPeriod(periods.week, calendar)
        ? fill(t.common.latestAvailable, { period: availablePeriodLabel(locale, periods.week, labelCopy) })
        : undefined,
    },
  };
}

export function repositoryTableLabels(t: Dict) {
  return {
    caption: t.tables.repositoryRankings,
    rank: t.tables.rank,
    repository: t.tables.repository,
    language: t.tables.language,
    unknown: t.tables.unknown,
    starsGained: t.tables.starsGained,
    growthRatePercent: t.tables.growthRatePercent,
    tenKCrossingDay: t.tables.tenKCrossingDay,
    day: t.tables.day,
    totalStars: t.tables.totalStars,
    rowStarsAdded: t.tables.rowStarsAdded,
  };
}
