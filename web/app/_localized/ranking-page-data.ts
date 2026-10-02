import type { Row } from "@/app/_explore/RankingList";
import type { RankItem, ReposLookup } from "@/lib/contracts";
import { getCategoryAssignmentsForRepos, getCategoryRegistry, getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { dateLabel } from "@/lib/format";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import type { Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { rankingCategoryExits } from "@/lib/ranking-category-exits";
import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import { isoWeek } from "@/lib/periods";
import { isCloudflareWorkersHost } from "@/lib/runtime-config";
import { detailText, fill } from "./detail-copy";

// Product display caps: preserve the existing compact overview and detail panels.
export const PULSE_MOVER_LIMIT = 8;
export const PULSE_GIANT_LIMIT = 6;
export const PULSE_ANNIVERSARY_LIMIT = 8;
export const RANKING_DETAIL_ROW_LIMIT = 100;
export const PRIMARY_PANEL_LIMIT = 18;
export const SECONDARY_PANEL_LIMIT = 10;
export const RANKING_FEATURED_LIMIT = 3;

export type NewcomerRow = Row & { crossedDate?: string };

export function projectRepoRows(items: readonly RankItem[], lookup: ReposLookup | null, mode: "gained" | "total" = "gained"): Row[] {
  if (!lookup) return [];
  return joinRepoRank([...items], lookup).map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    gained: mode === "gained" ? r.value : undefined,
    total: r.current_stars,
  }));
}

export function projectGrowthRows(items: readonly RankItem[], lookup: ReposLookup): Row[] {
  return joinRepoRank([...items], lookup).map((r) => ({
    owner: r.owner, name: r.name, lang: r.language, total: r.current_stars,
    rate: typeof r.rate === "number" ? r.rate : undefined,
  }));
}

export function projectNewcomerRows(items: readonly RankItem[], lookup: ReposLookup, locale: Locale): NewcomerRow[] {
  return joinRepoRank([...items], lookup).map((r) => ({
    owner: r.owner, name: r.name, lang: r.language, total: r.current_stars,
    crossedDate: r.date ? dateLabel(locale, r.date) : undefined,
  }));
}

type DetailReaders = {
  readRank?: typeof getRank;
  readHeatmap?: typeof getHeatmap;
  readLookup?: typeof getReposLookup;
  readRegistry?: typeof getCategoryRegistry;
  readAssignments?: typeof getCategoryAssignmentsForRepos;
  skipAssignments?: boolean;
};

/** One required flow view; year/month explicitly opt into growth, newcomers and heat. */
export async function loadRankingDetailData(window: "year" | "month" | "week", period: string, locale: Locale, {
  readRank = getRank,
  readHeatmap = getHeatmap,
  readLookup = getReposLookup,
  readRegistry = getCategoryRegistry,
  readAssignments = getCategoryAssignmentsForRepos,
  skipAssignments = isCloudflareWorkersHost(),
}: DetailReaders = {}) {
  const [flow, lookup, registry, growth, newc, heat] = await Promise.all([
    readRank(window, period, "repo", "flow"),
    readLookup(),
    readRegistry(),
    window === "week" ? null : readRank(window, period, "repo", "growth"),
    window === "week" ? null : readRank(window, period, "repo", "new"),
    window === "week" ? null : readHeatmap(window, period),
  ]);
  if (!flow || !lookup) return null;
  // Slice before joining: missing lookup rows must not pull later items into a capped panel.
  const leadItems = flow.items.slice(0, PRIMARY_PANEL_LIMIT);
  const assignments = skipAssignments ? null : await readAssignments(leadItems.flatMap((item) => item.id == null ? [] : [item.id]));
  const rows = projectRepoRows(flow.items.slice(0, RANKING_DETAIL_ROW_LIMIT), lookup);
  const timestamps = [flow.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at];
  return {
    flow, growth, newc, heat,
    rows,
    most: rows.slice(0, PRIMARY_PANEL_LIMIT),
    fastest: projectGrowthRows(growth?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup),
    newcomers: projectNewcomerRows(newc?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup, locale),
    categoryLinks: rankingCategoryExits(joinRepoRank(leadItems, lookup), registry, assignments),
    asOf: resolveDataAsOfLabel(...timestamps, { locale }),
    dateModified: resolveDataAsOfValue(...timestamps),
  };
}

/** Keep all three detail families' structured data aligned with their visible flow rows. */
export function rankingDetailStructuredData({ locale, path, label, rows, dateModified }: {
  locale: Locale; path: string; label: string; rows: Row[]; dateModified?: string | null;
}) {
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  return [
    collectionLd(fill(text.rankingCollectionName, { label }), path, language, { dateModified, about: datasetRef(path) }),
    datasetLd({ name: fill(text.rankingDatasetName, { label }), path, locale: language, description: fill(text.rankingDatasetDescription, { label }), dateModified }),
    itemListLd(fill(text.rankingItemListName, { label }), path, language, rows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) }))),
  ];
}

// At most two candidate reads per historical year. CF leaves room for core views,
// the availability resolver, recovered-live fallbacks, and OpenNext asset requests.
export const ARCHIVE_CHILD_PROBE_LIMIT = 24;
export const ARCHIVE_CHILD_PROBE_LIMIT_CF = 4;
export type ArchiveChildPeriods = { month: number | null; week: number | null };
type ArchiveRankReader = (window: "month" | "week", period: string, dim: "repo", metric: "flow") => ReturnType<typeof getRank>;

/** Calendar math chooses a candidate only; publication is established by its rank view. */
export async function loadArchiveChildPeriods(years: readonly number[], periods: AvailableRankPeriods, {
  readRank = getRank,
  probeLimit = isCloudflareWorkersHost() ? ARCHIVE_CHILD_PROBE_LIMIT_CF : ARCHIVE_CHILD_PROBE_LIMIT,
}: { readRank?: ArchiveRankReader; probeLimit?: number } = {}): Promise<Map<number, ArchiveChildPeriods>> {
  const children = new Map<number, ArchiveChildPeriods>();
  const probes: Array<{ year: number; window: "month" | "week"; value: number; period: string }> = [];
  for (const year of [...new Set(years)].sort((a, b) => b - a)) {
    const child: ArchiveChildPeriods = { month: null, week: null };
    children.set(year, child);
    if (periods.month.kind === "month") {
      if (year === periods.month.year) child.month = periods.month.month;
      else if (year < periods.month.year) probes.push({ year, window: "month", value: 12, period: `${year}-12` });
    }
    if (periods.week.kind === "week") {
      if (year === periods.week.year) child.week = periods.week.week;
      else if (year < periods.week.year) {
        const week = isoWeek(new Date(Date.UTC(year, 11, 28))).week;
        probes.push({ year, window: "week", value: week, period: `${year}-W${String(week).padStart(2, "0")}` });
      }
    }
  }
  await Promise.all(probes.slice(0, Math.max(0, probeLimit)).map(async (probe) => {
    const rank = await readRank(probe.window, probe.period, "repo", "flow");
    if (rank) children.get(probe.year)![probe.window] = probe.value;
  }));
  return children;
}
