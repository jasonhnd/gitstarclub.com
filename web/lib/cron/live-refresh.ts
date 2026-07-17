import { revalidatePath } from "next/cache";
import { getCurrentMonth, getHeatmapBase, getHotSnapshot, getRankBase, getReposLookup } from "@/lib/data";
import { putView } from "@/lib/data/write";
import { fetchStarCounts, type RepoRef } from "@/lib/github";
import { submitLiveOverlayIndexNow } from "@/lib/indexnow";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";
import { PendingPeriod } from "@/lib/contracts";
import type { CurrentMonth, Heatmap, RankItem, RankList } from "@/lib/contracts";

const TOP_N = 20;

type TopItem = { rank: number; id?: number; login?: string; value: number; prev_rank: null };

export type LiveRefreshJob = "daily" | "weekly";

export type LiveRefreshResult = {
  job: LiveRefreshJob;
  dry: boolean;
  day: string;
  month: string;
  week: string;
  polled: number;
  day_total: number;
  writes: string[];
  all_time_repo_1: TopItem | null;
  current_week_flow_1: TopItem | null;
  current_month_flow_1: TopItem | null;
};

export interface LiveRefreshOptions {
  now?: Date;
}

type CurrentStarLookup = Record<string, { current_stars: number }>;

export function reconcileCurrentMonth(
  lookup: CurrentStarLookup,
  existing: CurrentMonth | null,
  fresh: ReadonlyMap<number, number>,
  today: string,
): { currentMonth: CurrentMonth; dayTotal: number } {
  const month = today.slice(0, 7);
  const carryMonth = existing?.month === month ? existing : null;

  // Keep every prior series, including today's value for repos absent from a
  // partial GraphQL response. Only fetched repos are reconciled below.
  const perRepo: CurrentMonth["per_repo"] = {};
  if (carryMonth) {
    for (const [id, series] of Object.entries(carryMonth.per_repo)) perRepo[id] = [...series];
  }

  const mergedStars = new Map<number, number>(
    Object.entries(lookup).map(([id, entry]) => [Number(id), entry.current_stars]),
  );
  if (existing) {
    for (const [id, stars] of Object.entries(existing.current_stars)) mergedStars.set(Number(id), stars);
  }

  for (const [id, latestStars] of fresh) {
    const idKey = String(id);
    const previousObservedStars = existing?.current_stars[idKey] ?? lookup[idKey]?.current_stars;
    if (previousObservedStars == null) continue;

    // On a same-day retry, current_stars is already the latest observation.
    // Subtract the previously persisted day delta to recover the stable UTC
    // start-of-day baseline, then recompute the full day delta from it.
    const previousTodayDelta =
      carryMonth?.updated === today
        ? (carryMonth.per_repo[idKey]?.find(([date]) => date === today)?.[1] ?? 0)
        : 0;
    const startOfDayStars = previousObservedStars - previousTodayDelta;
    const fullDayDelta = latestStars - startOfDayStars;
    const withoutToday = (perRepo[idKey] ?? []).filter(([date]) => date !== today);
    if (fullDayDelta === 0) {
      if (withoutToday.length === 0) delete perRepo[idKey];
      else perRepo[idKey] = withoutToday;
    } else {
      perRepo[idKey] = upsert(withoutToday, today, fullDayDelta);
    }
    mergedStars.set(id, latestStars);
  }

  let dayTotal = 0;
  for (const series of Object.values(perRepo)) {
    dayTotal += series.find(([date]) => date === today)?.[1] ?? 0;
  }

  return {
    currentMonth: {
      month,
      updated: today,
      daily_totals: upsert(carryMonth?.daily_totals ?? [], today, dayTotal),
      per_repo: perRepo,
      current_stars: Object.fromEntries(mergedStars),
    },
    dayTotal,
  };
}

export async function refreshLiveViews(job: LiveRefreshJob, dry: boolean, opts: LiveRefreshOptions = {}): Promise<LiveRefreshResult> {
  const lookup = await getReposLookup();
  if (!lookup) throw new Error("lookup unavailable");

  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const periods = currentUtcPeriods(now);
  const weekPeriod = periods.weekPeriod;

  const [existingCM, snap, monthRank, weekRank, monthHeat] = await Promise.all([
    getCurrentMonth(),
    getHotSnapshot(),
    getRankBase("month", month, "repo", "flow"),
    getRankBase("week", weekPeriod, "repo", "flow"),
    getHeatmapBase("month", month),
  ]);

  const refs: RepoRef[] = Object.entries(lookup).map(([id, entry]) => ({
    id: Number(id),
    owner: entry.owner,
    name: entry.name,
  }));
  const canReuseToday = !dry && job === "weekly" && existingCM?.month === month && existingCM.updated === today;
  const fresh = canReuseToday ? new Map<number, number>() : await fetchStarCounts(dry ? refs.slice(0, 50) : refs);
  if (!dry && !canReuseToday && refs.length > 0 && fresh.size === 0) {
    throw new Error("GitHub returned no star counts; refusing to replace live state");
  }

  // Month rollover: the closing month's daily per_repo must be frozen to pending BEFORE
  // current_month.json is overwritten, else the L3 fold loses it (VERCEL-DATA-OPERATIONS §7.2).
  const rolledOver = !!existingCM && existingCM.month !== month;
  const { currentMonth, dayTotal } = reconcileCurrentMonth(lookup, existingCM, fresh, today);
  const { per_repo: perRepo, daily_totals: dailyTotals } = currentMonth;
  const mergedStars = new Map<number, number>(Object.entries(currentMonth.current_stars).map(([id, stars]) => [Number(id), stars]));
  const monthDeltas = repoDeltas(perRepo);
  const weekDeltas = repoDeltas(perRepo, (date) => {
    const week = isoWeek(new Date(`${date}T00:00:00.000Z`));
    return `${week.year}-W${String(week.week).padStart(2, "0")}` === weekPeriod;
  });

  const allRepo = topByValue([...mergedStars].map(([id, value]) => ({ id, value })));
  const orgSum = new Map<string, number>();
  for (const [id, value] of mergedStars) {
    const owner = lookup[String(id)]?.owner;
    if (owner) orgSum.set(owner, (orgSum.get(owner) ?? 0) + value);
  }
  const allOrg = topByValue([...orgSum].map(([login, value]) => ({ login, value })));

  const currentMonthFlow = topByValue(mergeRankFlow(monthRank?.items ?? [], monthDeltas));
  const currentWeekFlow = topByValue(mergeRankFlow(weekRank?.items ?? [], weekDeltas));
  const currentMonthTop = {
    flow: currentMonthFlow,
    stock: topByValue([...mergedStars].map(([id, value]) => ({ id, value }))),
  };

  const hotSnapshot = {
    generated_at: now.toISOString(),
    home: {
      year_spine: snap?.home.year_spine ?? [],
      current_month_top: currentMonthTop,
      on_this_day: snap?.home.on_this_day ?? [],
    },
    current_year: snap?.current_year ?? currentMonthTop,
    current_month: currentMonthTop,
    all_time: { repo: allRepo, org: allOrg },
  };
  const monthHeatmap = mergeMonthHeatmap(monthHeat, month, dailyTotals, now);

  const writes = [
    ...(rolledOver ? [`canonical/v2/pending/${existingCM!.month}.json`] : []),
    "current_month.json",
    "hot-snapshot.json",
    `live/rank/month/${month}/repo/flow.json`,
    `live/rank/month/${month}/repo/stock.json`,
    `live/rank/week/${weekPeriod}/repo/flow.json`,
    `live/heatmap/month/${month}.json`,
  ];

  const result: LiveRefreshResult = {
    job,
    dry,
    day: today,
    month,
    week: weekPeriod,
    polled: fresh.size,
    day_total: dayTotal,
    writes: dry ? [] : writes,
    all_time_repo_1: allRepo[0] ?? null,
    current_week_flow_1: currentWeekFlow[0] ?? null,
    current_month_flow_1: currentMonthFlow[0] ?? null,
  };

  if (dry) return result;

  // freeze the closing month FIRST (before current_month.json is overwritten below).
  if (rolledOver) {
    const pending = PendingPeriod.parse({
      period: existingCM!.month,
      frozen_at: now.toISOString(),
      daily_totals: existingCM!.daily_totals,
      per_repo: existingCM!.per_repo,
    });
    await putView(`canonical/v2/pending/${existingCM!.month}.json`, pending);
  }

  await Promise.all([
    putView("current_month.json", currentMonth),
    putView("hot-snapshot.json", hotSnapshot),
    putView(`live/rank/month/${month}/repo/flow.json`, rankList("month", month, "repo", "flow", currentMonthFlow, now)),
    putView(`live/rank/month/${month}/repo/stock.json`, rankList("month", month, "repo", "stock", currentMonthTop.stock, now)),
    putView(`live/rank/week/${weekPeriod}/repo/flow.json`, rankList("week", weekPeriod, "repo", "flow", currentWeekFlow, now)),
    putView(`live/heatmap/month/${month}.json`, monthHeatmap),
  ]);

  revalidateLivePaths(periods);
  const moverRepoIds = topRepoIds(currentMonthFlow, currentWeekFlow);
  await submitLiveOverlayIndexNow({
    job,
    day: today,
    year: periods.year,
    monthPeriod: month,
    weekPeriod,
    repos: lookup,
    repoIds: moverRepoIds,
    orgLogins: ownerLoginsForRepoIds(moverRepoIds, lookup),
  });
  return result;
}

function upsert(series: [string, number][], date: string, value: number): [string, number][] {
  return [...series.filter(([d]) => d !== date), [date, value] as [string, number]].sort(([a], [b]) => a.localeCompare(b));
}

function topByValue(pairs: { id?: number; login?: string; value: number }[]): TopItem[] {
  return [...pairs]
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N)
    .map((pair, index) => ({
      rank: index + 1,
      ...(pair.id != null ? { id: pair.id } : { login: pair.login }),
      value: pair.value,
      prev_rank: null,
    }));
}

function repoDeltas(perRepo: Record<string, [string, number][]>, includeDate?: (date: string) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const [id, series] of Object.entries(perRepo)) {
    const value = series.reduce((sum, [date, delta]) => sum + (includeDate && !includeDate(date) ? 0 : delta), 0);
    if (value !== 0) out.set(Number(id), value);
  }
  return out;
}

function mergeRankFlow(baseItems: RankItem[], deltas: Map<number, number>): { id: number; value: number }[] {
  const merged = new Map<number, number>();
  for (const item of baseItems) {
    if (item.id != null) merged.set(item.id, item.value);
  }
  for (const [id, delta] of deltas) merged.set(id, (merged.get(id) ?? 0) + delta);
  return [...merged].map(([id, value]) => ({ id, value }));
}

function topRepoIds(...lists: TopItem[][]): number[] {
  return [...new Set(lists.flatMap((items) => items.map((item) => item.id).filter((id): id is number => id != null)))];
}

function ownerLoginsForRepoIds(ids: number[], lookup: Awaited<ReturnType<typeof getReposLookup>>): string[] {
  if (!lookup) return [];
  return [...new Set(ids.map((id) => lookup[String(id)]?.owner).filter((owner): owner is string => !!owner))];
}

function rankList(
  window: "week" | "month",
  period: string,
  dim: "repo",
  metric: "flow" | "stock",
  items: RankItem[],
  now: Date,
): RankList {
  return {
    meta: {
      window,
      period,
      dim,
      metric,
      generated_at: now.toISOString(),
    },
    items,
  };
}

function mergeMonthHeatmap(base: Heatmap | null, period: string, dailyTotals: [string, number][], now: Date): Heatmap {
  const cells = new Map<string, number>();
  if (base?.meta.period === period) {
    for (const [date, value] of base.cells) cells.set(date, value);
  }
  for (const [date, value] of dailyTotals) cells.set(date, value);
  return {
    meta: {
      scope: "month",
      period,
      generated_at: now.toISOString(),
    },
    cells: [...cells].sort(([a], [b]) => a.localeCompare(b)),
  };
}

function revalidateLivePaths(periods: ReturnType<typeof currentUtcPeriods>): void {
  const [calendarYear, calendarMonth] = periods.monthPeriod.split("-");
  const [weekYear, weekNumber] = periods.weekPeriod.split("-W");
  const suffixes = [
    "",
    "/pulse",
    "/rankings",
    `/rankings/${calendarYear}`,
    `/rankings/${calendarYear}/${Number(calendarMonth)}`,
    `/rankings/${weekYear}/W${weekNumber}`,
  ];
  for (const suffix of suffixes) revalidatePath(suffix || "/");
}
