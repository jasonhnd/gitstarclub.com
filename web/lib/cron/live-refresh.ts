import { revalidatePath } from "next/cache";
import { getCurrentMonth, getHeatmapBase, getHotSnapshot, getRankBase, getReposLookup } from "@/lib/data";
import { putView } from "@/lib/data/write";
import { fetchStarCounts, type RepoRef } from "@/lib/github";
import { submitLiveOverlayIndexNow } from "@/lib/indexnow";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";
import { PendingPeriod } from "@/lib/contracts";
import type { Heatmap, RankItem, RankList } from "@/lib/contracts";

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

export function liveRefreshPeriods(now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const periods = currentUtcPeriods(now);
  return { now, today, month, periods, weekPeriod: periods.weekPeriod };
}

export function repoRefsFromLookup(lookup: NonNullable<Awaited<ReturnType<typeof getReposLookup>>>): RepoRef[] {
  return Object.entries(lookup).map(([id, entry]) => ({
    id: Number(id),
    owner: entry.owner,
    name: entry.name,
  }));
}

export async function refreshLiveViews(job: LiveRefreshJob, dry: boolean): Promise<LiveRefreshResult> {
  const lookup = await getReposLookup();
  if (!lookup) throw new Error("lookup unavailable");

  const { now, today, month, periods, weekPeriod } = liveRefreshPeriods();

  const [existingCM, snap, monthRank, weekRank, monthHeat] = await Promise.all([
    getCurrentMonth(),
    getHotSnapshot(),
    getRankBase("month", month, "repo", "flow"),
    getRankBase("week", weekPeriod, "repo", "flow"),
    getHeatmapBase("month", month),
  ]);

  const refs = repoRefsFromLookup(lookup);
  const canReuseToday = !dry && job === "weekly" && existingCM?.month === month && existingCM.updated === today;
  const fresh = canReuseToday ? new Map<number, number>() : await fetchStarCounts(dry ? refs.slice(0, 50) : refs);
  const recalculatesToday = fresh.size > 0;

  // Month rollover: the closing month's daily per_repo must be frozen to pending BEFORE
  // current_month.json is overwritten, else the L3 fold loses it (VERCEL-DATA-OPERATIONS §7.2).
  const rolledOver = !!existingCM && existingCM.month !== month;
  const carryMonth = existingCM?.month === month ? existingCM : undefined;
  const prevStars = (id: number) => existingCM?.current_stars?.[String(id)] ?? lookup[String(id)].current_stars;
  const mergedStars = new Map<number, number>(refs.map((ref) => [ref.id, lookup[String(ref.id)].current_stars]));
  if (existingCM) for (const [id, stars] of Object.entries(existingCM.current_stars)) mergedStars.set(Number(id), stars);
  for (const [id, stars] of fresh) mergedStars.set(id, stars);

  const perRepo: Record<string, [string, number][]> = {};
  if (carryMonth) {
    for (const [id, series] of Object.entries(carryMonth.per_repo)) {
      perRepo[id] = recalculatesToday ? series.filter(([date]) => date !== today) : series;
    }
  }

  let dayTotal = carryMonth?.daily_totals.find(([date]) => date === today)?.[1] ?? 0;
  if (recalculatesToday) {
    dayTotal = 0;
    for (const [id, stars] of fresh) {
      const delta = stars - prevStars(id);
      dayTotal += delta;
      if (delta !== 0) perRepo[String(id)] = upsert(perRepo[String(id)] ?? [], today, delta);
    }
  }
  const dailyTotals = recalculatesToday ? upsert(carryMonth?.daily_totals ?? [], today, dayTotal) : carryMonth?.daily_totals ?? [];
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

  const currentMonth = {
    month,
    updated: today,
    daily_totals: dailyTotals,
    per_repo: perRepo,
    current_stars: Object.fromEntries(mergedStars),
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
  const suffixes = [
    "",
    "/pulse",
    "/rankings",
    `/rankings/${periods.year}`,
    `/rankings/${periods.year}/${periods.month}`,
    `/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`,
  ];
  for (const suffix of suffixes) revalidatePath(suffix || "/");
}
