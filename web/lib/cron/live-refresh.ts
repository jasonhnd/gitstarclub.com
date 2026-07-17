import { revalidatePath } from "next/cache";
import { getCurrentMonth, getHeatmapBase, getHotSnapshot, getRankBase, getReposLookup } from "@/lib/data";
import { fetchStarCounts, type RepoRef } from "@/lib/github";
import { submitLiveOverlayIndexNow } from "@/lib/indexnow";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";
import { CurrentMonth, Heatmap, HotSnapshot, PendingPeriod, RankList } from "@/lib/contracts";
import type { HotSnapshot as HotSnapshotData, HotSnapshotFreshness, RankItem } from "@/lib/contracts";
import {
  publishLiveGeneration,
  type LivePublicationArtifact,
  type LivePublicationStore,
} from "./live-publication";

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
  generation: string | null;
  previous_generation: string | null;
  published_at: string | null;
  post_commit_errors: string[];
};

export interface LiveRefreshDependencies {
  getReposLookup: typeof getReposLookup;
  getCurrentMonth: typeof getCurrentMonth;
  getHotSnapshot: typeof getHotSnapshot;
  getRankBase: typeof getRankBase;
  getHeatmapBase: typeof getHeatmapBase;
  fetchStarCounts: typeof fetchStarCounts;
  submitLiveOverlayIndexNow: typeof submitLiveOverlayIndexNow;
  revalidatePath: typeof revalidatePath;
  currentUtcPeriods: typeof currentUtcPeriods;
  isoWeek: typeof isoWeek;
}

export interface LiveRefreshOptions {
  now?: Date;
  /** Test seam for the atomic publisher. Production always uses the Blob CAS implementation. */
  publisher?: typeof publishLiveGeneration;
  /** Test seam; production uses the imported read/network/cache functions. */
  dependencies?: Partial<LiveRefreshDependencies>;
  publication?: {
    runId: string;
    idempotencyKey: string;
    store?: LivePublicationStore;
  };
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
  const dependencies: LiveRefreshDependencies = {
    getReposLookup,
    getCurrentMonth,
    getHotSnapshot,
    getRankBase,
    getHeatmapBase,
    fetchStarCounts,
    submitLiveOverlayIndexNow,
    revalidatePath,
    currentUtcPeriods,
    isoWeek,
    ...opts.dependencies,
  };
  const lookup = await dependencies.getReposLookup();
  if (!lookup) throw new Error("lookup unavailable");

  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const periods = dependencies.currentUtcPeriods(now);
  const weekPeriod = periods.weekPeriod;

  const [existingCM, snap, monthRank, weekRank, yearRank, monthHeat, yearHeat] = await Promise.all([
    dependencies.getCurrentMonth(),
    dependencies.getHotSnapshot(),
    dependencies.getRankBase("month", month, "repo", "flow"),
    dependencies.getRankBase("week", weekPeriod, "repo", "flow"),
    dependencies.getRankBase("year", String(periods.year), "repo", "flow"),
    dependencies.getHeatmapBase("month", month),
    dependencies.getHeatmapBase("year", String(periods.year)),
  ]);

  const refs: RepoRef[] = Object.entries(lookup).map(([id, entry]) => ({
    id: Number(id),
    owner: entry.owner,
    name: entry.name,
  }));
  const canReuseToday = !dry && job === "weekly" && existingCM?.month === month && existingCM.updated === today;
  const fresh = canReuseToday ? new Map<number, number>() : await dependencies.fetchStarCounts(dry ? refs.slice(0, 50) : refs);
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
    const week = dependencies.isoWeek(new Date(`${date}T00:00:00.000Z`));
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
  const nowIso = now.toISOString();
  const fullPoll = !canReuseToday && fresh.size === refs.length;
  const currentMonthAsOf = fullPoll
    ? nowIso
    : (snapshotSectionAsOf(snap, "current_month") ?? `${today}T00:00:00.000Z`);
  const monthRankAsOf = earliestTimestamp(currentMonthAsOf, monthRank?.meta.generated_at ?? currentMonthAsOf);
  const weekRankAsOf = earliestTimestamp(currentMonthAsOf, weekRank?.meta.generated_at ?? currentMonthAsOf);
  const monthHeatAsOf = earliestTimestamp(currentMonthAsOf, monthHeat?.meta.generated_at ?? currentMonthAsOf);

  const currentYear = yearRank
    ? {
        flow: topByValue(mergeRankFlow(yearRank.items, monthDeltas)),
        stock: currentMonthTop.stock,
      }
    : (snap?.current_year ?? currentMonthTop);
  const currentYearAsOf = yearRank
    ? earliestTimestamp(currentMonthAsOf, yearRank.meta.generated_at)
    : snapshotSectionAsOf(snap, "current_year");
  const { values: yearSpine, asOf: yearSpineAsOf } = yearHeat
    ? {
        values: mergeYearSpine(snap?.home.year_spine ?? [], yearHeat, String(periods.year), month, dailyTotals),
        asOf: earliestTimestamp(currentMonthAsOf, yearHeat.meta.generated_at),
      }
    : {
        values: snap?.home.year_spine ?? [],
        asOf: snapshotSectionAsOf(snap, "year_spine"),
      };
  const onThisDay = validOnThisDay(snap, today);
  const freshness: HotSnapshotFreshness = {
    current_month: currentMonthAsOf,
    current_year: currentYearAsOf,
    year_spine: yearSpineAsOf,
    on_this_day: onThisDay.asOf,
    all_time: fullPoll ? nowIso : snapshotSectionAsOf(snap, "all_time"),
  };
  const hotSnapshot = HotSnapshot.parse({
    // This global timestamp is deliberately conservative. Consumers that need
    // section precision use `freshness`; legacy consumers never see a date
    // newer than any known carried source.
    generated_at: earliestKnownTimestamp(freshness) ?? nowIso,
    freshness,
    home: {
      year_spine: yearSpine,
      current_month_top: currentMonthTop,
      on_this_day: onThisDay.items,
    },
    current_year: currentYear,
    current_month: currentMonthTop,
    all_time: { repo: allRepo, org: allOrg },
  });
  const monthHeatmap = Heatmap.parse(mergeMonthHeatmap(monthHeat, month, dailyTotals, monthHeatAsOf));
  const parsedCurrentMonth = CurrentMonth.parse(currentMonth);
  const monthFlowList = RankList.parse(rankList("month", month, "repo", "flow", currentMonthFlow, monthRankAsOf));
  const monthStockList = RankList.parse(rankList("month", month, "repo", "stock", currentMonthTop.stock, currentMonthAsOf));
  const weekFlowList = RankList.parse(rankList("week", weekPeriod, "repo", "flow", currentWeekFlow, weekRankAsOf));

  const artifacts: LivePublicationArtifact[] = [
    { path: "current_month.json", data: parsedCurrentMonth },
    { path: "hot-snapshot.json", data: hotSnapshot },
    { path: `rank/month/${month}/repo/flow.json`, data: monthFlowList },
    { path: `rank/month/${month}/repo/stock.json`, data: monthStockList },
    { path: `rank/week/${weekPeriod}/repo/flow.json`, data: weekFlowList },
    { path: `heatmap/month/${month}.json`, data: monthHeatmap },
  ];
  const prerequisites: LivePublicationArtifact[] = [];
  if (rolledOver) {
    const pending = PendingPeriod.parse({
      period: existingCM!.month,
      // Stable across retries for the same UTC-day idempotency key.
      frozen_at: `${today}T00:00:00.000Z`,
      daily_totals: existingCM!.daily_totals,
      per_repo: existingCM!.per_repo,
    });
    prerequisites.push({ path: `canonical/v2/pending/${existingCM!.month}.json`, data: pending });
    artifacts.push({ path: `rollover/${existingCM!.month}.json`, data: pending });
  }

  const generation = opts.publication?.runId ?? null;
  const writes = generation
    ? [
        ...prerequisites.map(({ path }) => path),
        ...artifacts.map(({ path }) => `live/generations/${generation}/${path}`),
        `live/generations/${generation}/manifest.json`,
        "live/latest.json",
      ]
    : [];

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
    generation: null,
    previous_generation: null,
    published_at: null,
    post_commit_errors: [],
  };

  if (dry) return result;
  if (!opts.publication) throw new Error("non-dry live refresh requires an acquired publication lease");

  const publication = await (opts.publisher ?? publishLiveGeneration)(
    {
      runId: opts.publication.runId,
      idempotencyKey: opts.publication.idempotencyKey,
      job,
      day: today,
      month,
      week: weekPeriod,
      createdAt: nowIso,
      artifacts,
      prerequisites,
    },
    opts.publication.store,
  );
  result.generation = publication.generation;
  result.previous_generation = publication.previous_generation;
  result.published_at = publication.published_at;

  // These effects must never run before the pointer commits, and a transient
  // post-commit failure must not misreport the already-published generation as
  // an uncommitted refresh.
  try {
    revalidateLivePaths(periods, dependencies.revalidatePath);
  } catch (error) {
    result.post_commit_errors.push(`revalidate: ${errorMessage(error)}`);
  }
  const moverRepoIds = topRepoIds(currentMonthFlow, currentWeekFlow);
  try {
    await dependencies.submitLiveOverlayIndexNow({
      job,
      day: today,
      year: periods.year,
      monthPeriod: month,
      weekPeriod,
      repos: lookup,
      repoIds: moverRepoIds,
      orgLogins: ownerLoginsForRepoIds(moverRepoIds, lookup),
    });
  } catch (error) {
    result.post_commit_errors.push(`indexnow: ${errorMessage(error)}`);
  }
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
  generatedAt: string,
): RankList {
  return {
    meta: {
      window,
      period,
      dim,
      metric,
      generated_at: generatedAt,
    },
    items,
  };
}

function mergeMonthHeatmap(base: Heatmap | null, period: string, dailyTotals: [string, number][], generatedAt: string): Heatmap {
  const cells = new Map<string, number>();
  if (base?.meta.period === period) {
    for (const [date, value] of base.cells) cells.set(date, value);
  }
  for (const [date, value] of dailyTotals) cells.set(date, value);
  return {
    meta: {
      scope: "month",
      period,
      generated_at: generatedAt,
    },
    cells: [...cells].sort(([a], [b]) => a.localeCompare(b)),
  };
}

function mergeYearSpine(
  existing: [string, number][],
  base: Heatmap,
  year: string,
  currentMonth: string,
  currentMonthDailyTotals: [string, number][],
): [string, number][] {
  const cells = new Map<string, number>();
  for (const [date, value] of base.cells) {
    // Year heatmaps store month keys (YYYY-MM); tolerate historical daily-key
    // fixtures too. Replace either representation for the active month.
    if (date !== currentMonth && !date.startsWith(`${currentMonth}-`)) cells.set(date, value);
  }
  for (const [date, value] of currentMonthDailyTotals) cells.set(date, value);
  const total = [...cells.values()].reduce((sum, value) => sum + value, 0);
  return [...existing.filter(([candidate]) => candidate !== year), [year, total] as [string, number]]
    .sort(([a], [b]) => a.localeCompare(b));
}

function snapshotSectionAsOf(
  snapshot: HotSnapshotData | null,
  section: keyof HotSnapshotFreshness,
): string | null {
  if (!snapshot) return null;
  return snapshot.freshness ? snapshot.freshness[section] : snapshot.generated_at;
}

function validOnThisDay(
  snapshot: HotSnapshotData | null,
  today: string,
): { items: HotSnapshotData["home"]["on_this_day"]; asOf: string | null } {
  if (!snapshot) return { items: [], asOf: null };
  const monthDay = today.slice(5);
  const items = snapshot.home.on_this_day.filter((item) => item.date.slice(5) === monthDay);
  const sourceAsOf = snapshotSectionAsOf(snapshot, "on_this_day");
  // A non-empty matching list is immutable historical milestone data. An
  // empty list is only authoritative if it was actually generated today.
  const asOf = items.length > 0 || sourceAsOf?.slice(0, 10) === today ? sourceAsOf : null;
  return { items, asOf };
}

function earliestTimestamp(...timestamps: string[]): string {
  return timestamps.reduce((earliest, candidate) =>
    Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest,
  );
}

function earliestKnownTimestamp(freshness: HotSnapshotFreshness): string | null {
  const timestamps = Object.values(freshness).filter((value): value is string => value !== null);
  return timestamps.length > 0 ? timestamps.reduce((earliest, candidate) => earliestTimestamp(earliest, candidate)) : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "unexpected failure";
}

function revalidateLivePaths(periods: ReturnType<typeof currentUtcPeriods>, invalidate: typeof revalidatePath): void {
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
  for (const suffix of suffixes) invalidate(suffix || "/");
}
