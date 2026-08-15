import { CATEGORY_DIMENSIONS, slugifyCategoryPart } from "@/lib/categories/rules";
import { MAX_COMPARE } from "@/lib/compare/constants";
import type { CategoryAssignments, CategoryRegistry } from "@/lib/contracts";
import {
  categoryHref,
  languageHref,
  rankingMonthHrefIfRoutable,
  repoRankingAppearances,
  type CategoryLink,
  type RepoHubRankingAppearance,
} from "@/lib/repo-page";

export const ORG_HUB_CATEGORY_LIMIT = 8;

export type OrgHub = {
  categories: CategoryLink[];
  compare: { href: string; fullNames: string[] } | null;
  rankingAppearances: RepoHubRankingAppearance[];
};

export function orgCategoryLinks(
  memberIds: readonly number[],
  memberLanguages: readonly (string | null | undefined)[],
  assignments: CategoryAssignments | null,
  registry: CategoryRegistry | null,
  limit = ORG_HUB_CATEGORY_LIMIT,
): CategoryLink[] {
  const counts = new Map<string, { link: CategoryLink; count: number }>();
  const bump = (link: CategoryLink) => {
    const existing = counts.get(link.id);
    if (existing) existing.count += 1;
    else counts.set(link.id, { link, count: 1 });
  };

  for (const name of memberLanguages) {
    if (!name?.trim()) continue;
    bump({ id: `language/${slugifyCategoryPart(name)}`, label: name, href: languageHref(name) });
  }

  if (assignments && registry) {
    const registryById = new Map(
      registry.dimensions.flatMap((dimension) =>
        dimension.categories.filter((category) => category.public).map((category) => [category.id, category] as const),
      ),
    );
    for (const id of memberIds) {
      const assignment = assignments.repositories[String(id)];
      if (!assignment) continue;
      for (const dimension of CATEGORY_DIMENSIONS) {
        for (const categoryId of assignment[dimension]) {
          const category = registryById.get(categoryId);
          if (!category) continue;
          bump({
            id: category.id,
            label: category.label,
            href: categoryHref(category.dimension, category.slug),
          });
        }
      }
    }
  }

  if (registry) {
    const publicIds = new Set(
      registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public).map((category) => category.id)),
    );
    for (const id of [...counts.keys()]) {
      if (!publicIds.has(id)) counts.delete(id);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.link.id.localeCompare(b.link.id))
    .slice(0, limit)
    .map((entry) => entry.link);
}

/** Compare the org's top tracked members by current-star order, capped at MAX_COMPARE. */
export function orgCompareHref(memberFullNames: readonly string[]): string | null {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const name of memberFullNames) {
    const trimmed = name.trim();
    if (!trimmed.includes("/")) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
    if (unique.length >= MAX_COMPARE) break;
  }
  if (unique.length === 0) return null;
  return `/compare?repos=${encodeURIComponent(unique.join(","))}`;
}

export function buildOrgHub(input: {
  memberIds: readonly number[];
  memberFullNames: readonly string[];
  memberLanguages: readonly (string | null | undefined)[];
  assignments: CategoryAssignments | null;
  registry: CategoryRegistry | null;
  rankHistory?: { month?: Array<[string, number]> };
}): OrgHub {
  const fullNames = [...new Set(input.memberFullNames.filter((name) => name.includes("/")))];
  const compareHref = orgCompareHref(fullNames);
  return {
    categories: orgCategoryLinks(input.memberIds, input.memberLanguages, input.assignments, input.registry),
    compare: compareHref ? { href: compareHref, fullNames: fullNames.slice(0, MAX_COMPARE) } : null,
    rankingAppearances: repoRankingAppearances({
      rank_history: input.rankHistory,
      monthly_table: [],
    }).filter((appearance) => rankingMonthHrefIfRoutable(appearance.period)),
  };
}
