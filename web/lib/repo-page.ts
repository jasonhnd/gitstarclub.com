import { CATEGORY_DIMENSIONS, categoryLanguageNamesFromRepository, slugifyCategoryPart } from "@/lib/categories/rules";
import type { CategoryAssignments, CategoryRegistry, RepoLookupEntry } from "@/lib/contracts";
import { ymParts } from "@/lib/format";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";

export type RepoLanguage = { name: string; size?: number | null; color?: string | null };
export type CategoryLink = { id: string; label: string; href: string };
export type RelatedRepo = Pick<RepoLookupEntry, "full_name" | "owner" | "name" | "language" | "current_stars">;
export type RepoHubRankingAppearance = { period: string; rank: number; adds?: number | null };
export type RepoHub = {
  owner: { login: string; href: string };
  compare: { href: string };
  categories: CategoryLink[];
  rankingAppearances: RepoHubRankingAppearance[];
  related: RelatedRepo[];
};

/** #356 hub link types. Tests fail if any type disappears from a complete fixture or the rendered page. */
export const REPO_HUB_LINK_TYPES = ["owner", "publicCategory", "compare", "historicalRankingPeriod", "related"] as const;
export type RepoHubLinkType = (typeof REPO_HUB_LINK_TYPES)[number];

export const REPO_HUB_RELATED_LIMIT = 6;
export const REPO_HUB_RANKING_APPEARANCES_LIMIT = 12;

export function repoLanguageEntries(repo: { language: string | null; languages?: RepoLanguage[] }): RepoLanguage[] {
  const primarySlug = repo.language ? slugifyCategoryPart(repo.language) : null;
  const breakdown = repo.languages ?? [];
  const primaryEntry = primarySlug ? breakdown.find((language) => slugifyCategoryPart(language.name) === primarySlug) ?? { name: repo.language!, size: null, color: null } : null;
  const source = primaryEntry ? [primaryEntry, ...breakdown.filter((language) => slugifyCategoryPart(language.name) !== primarySlug)] : breakdown;
  const categoryLanguageSlugs = new Set(categoryLanguageNamesFromRepository(repo).map(slugifyCategoryPart));
  const seen = new Set<string>();
  return source.filter((language) => {
    const name = language.name.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return false;
    if (!categoryLanguageSlugs.has(slugifyCategoryPart(name))) return false;
    seen.add(key);
    return true;
  });
}

export function languageHref(name: string): string {
  return `/categories/language/${slugifyCategoryPart(name)}`;
}

export function categoryHref(dimension: string, slug: string): string {
  return `/categories/${dimension}/${slug}`;
}

export function repoCategoryLinks(
  repoId: number,
  assignments: CategoryAssignments | null,
  registry: CategoryRegistry | null,
  languages: RepoLanguage[],
): CategoryLink[] {
  const links = new Map<string, CategoryLink>();
  for (const language of languages.slice(0, 3)) {
    const slug = slugifyCategoryPart(language.name);
    links.set(`language/${slug}`, { id: `language/${slug}`, label: language.name, href: languageHref(language.name) });
  }

  const assignment = assignments?.repositories[String(repoId)];
  if (!assignment || !registry) return [...links.values()].slice(0, 8);

  const registryById = new Map(
    registry.dimensions.flatMap((dimension) =>
      dimension.categories.filter((category) => category.public).map((category) => [category.id, category] as const),
    ),
  );

  for (const dimension of CATEGORY_DIMENSIONS) {
    for (const id of assignment[dimension]) {
      const category = registryById.get(id);
      if (!category || links.has(category.id)) continue;
      links.set(category.id, {
        id: category.id,
        label: category.label,
        href: categoryHref(category.dimension, category.slug),
      });
    }
  }

  return [...links.values()].slice(0, 8);
}

export function ownerHref(owner: string): string {
  return `/o/${owner}`;
}

export function compareHref(fullName: string): string {
  return `/compare?repos=${encodeURIComponent(fullName)}`;
}

export function rankingMonthHref(period: string): string {
  const { y, m } = ymParts(period);
  return `/rankings/${y}/${m}`;
}

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Ranking month path when the UTC month is a valid `/rankings/{year}/{month}` route, else null.
 *  Does not probe Blob for a published rank view. */
export function rankingMonthHrefIfRoutable(periodOrDate: string, now = new Date()): string | null {
  const period = periodOrDate.length >= 7 ? periodOrDate.slice(0, 7) : periodOrDate;
  if (!YEAR_MONTH_RE.test(period)) return null;
  const { y, m } = ymParts(period);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  const current = currentUtcPeriods(now);
  if (y < FIRST_YEAR) return null;
  if (y > current.year || (y === current.year && m > current.month)) return null;
  return rankingMonthHref(period);
}

export function repoRankingAppearances(
  repo: {
    rank_history?: { month?: Array<[string, number]> };
    monthly_table: Array<{ month: string; adds: number; rank: number | null }>;
  },
  limit = REPO_HUB_RANKING_APPEARANCES_LIMIT,
): RepoHubRankingAppearance[] {
  const addsByPeriod = new Map(repo.monthly_table.map((row) => [row.month, row.adds] as const));
  const source = repo.rank_history?.month?.length
    ? repo.rank_history.month
    : repo.monthly_table.flatMap((row) => (row.rank == null ? [] : ([[row.month, row.rank]] as Array<[string, number]>)));

  return source
    .filter(([, rank]) => Number.isFinite(rank))
    .map(([period, rank]) => ({ period, rank, adds: addsByPeriod.get(period) }))
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, limit);
}

export function buildRepoHub(input: {
  repoId: number;
  owner: string;
  fullName: string;
  language: string | null;
  languages: RepoLanguage[];
  rankHistory?: { month?: Array<[string, number]> };
  monthlyTable: Array<{ month: string; adds: number; rank: number | null }>;
  assignments: CategoryAssignments | null;
  registry: CategoryRegistry | null;
  lookup: Record<string, RepoLookupEntry> | null;
}): RepoHub {
  return {
    owner: { login: input.owner, href: ownerHref(input.owner) },
    compare: { href: compareHref(input.fullName) },
    categories: repoCategoryLinks(input.repoId, input.assignments, input.registry, input.languages),
    rankingAppearances: repoRankingAppearances({
      rank_history: input.rankHistory,
      monthly_table: input.monthlyTable,
    }),
    related: relatedRepositories(
      { full_name: input.fullName, owner: input.owner, language: input.language },
      input.lookup,
    ),
  };
}

export function repoHubPresentLinkTypes(hub: RepoHub): RepoHubLinkType[] {
  const types: RepoHubLinkType[] = ["owner", "compare"];
  if (hub.categories.length > 0) types.push("publicCategory");
  if (hub.rankingAppearances.length > 0) types.push("historicalRankingPeriod");
  if (hub.related.length > 0) types.push("related");
  return types;
}

export function relatedRepositories(
  repo: { full_name: string; owner: string; language: string | null },
  lookup: Record<string, RepoLookupEntry> | null,
  limit = REPO_HUB_RELATED_LIMIT,
): RelatedRepo[] {
  if (!lookup) return [];
  const rows = Object.values(lookup).filter(
    (entry) => entry.active !== false && entry.full_name !== repo.full_name,
  );
  const sort = (a: RepoLookupEntry, b: RepoLookupEntry) => b.current_stars - a.current_stars || a.full_name.localeCompare(b.full_name);
  const seen = new Set<string>();
  const related: RelatedRepo[] = [];

  for (const entry of rows.filter((candidate) => candidate.owner === repo.owner).sort(sort)) {
    if (seen.has(entry.full_name)) continue;
    seen.add(entry.full_name);
    related.push(entry);
  }

  if (repo.language) {
    for (const entry of rows.filter((candidate) => candidate.language === repo.language && candidate.owner !== repo.owner).sort(sort)) {
      if (seen.has(entry.full_name)) continue;
      seen.add(entry.full_name);
      related.push(entry);
      if (related.length >= limit) break;
    }
  }

  return related.slice(0, limit);
}
