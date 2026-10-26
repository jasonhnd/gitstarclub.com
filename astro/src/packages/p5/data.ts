import { getCurrentMonth, getHeatmap, getHotSnapshot, getMeta, getRank, getRepoIdByFullName, getReposLookup } from "../../../../web/lib/data";
import { resolveAvailableRankPeriodsForTest, rankPeriodLookbackLimits } from "../../../../web/lib/data/rank-periods";
import { loadPairConclusions } from "../../../../web/app/_localized/comparison-page-data";
import type { Dict, Locale } from "../../../../web/lib/i18n";
import type { pageData } from "../../lib/data";
import { withPublishedReaders } from "../../lib/published-readers";

type Data = ReturnType<typeof pageData>;

export function loadCompare(data: Data, locale: Locale, t: Dict) {
  return withPublishedReaders(data, async () => {
    const [meta, repoIds] = await Promise.all([getMeta(), getRepoIdByFullName()]);
    return { meta, pairs: await loadPairConclusions(repoIds, locale, t.compare) };
  });
}

export function loadPulse(data: Data, now = new Date()) {
  return withPublishedReaders(data, async () => {
    const [snap, lookup, availablePeriods, meta, currentMonth] = await Promise.all([
      getHotSnapshot(), getReposLookup(), resolveAvailableRankPeriodsForTest({ now, ...rankPeriodLookbackLimits({ HOSTING_TARGET: "cf" }) }), getMeta(), getCurrentMonth(),
    ]);
    const [activeWeekRank, activeMonthRank, monthHeat] = await Promise.all([
      availablePeriods.week.kind === "week" ? getRank("week", availablePeriods.week.period, "repo", "flow") : null,
      availablePeriods.month.kind === "month" ? getRank("month", availablePeriods.month.period, "repo", "flow") : null,
      availablePeriods.month.kind === "month" && availablePeriods.month.period !== currentMonth?.month
        ? getHeatmap("month", availablePeriods.month.period) : null,
    ]);
    return { snap, lookup, availablePeriods, activeWeekRank, activeMonthRank, meta, currentMonth, monthHeat };
  });
}

export type PulseData = Awaited<ReturnType<typeof loadPulse>>;
