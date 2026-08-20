import { slugifyCategoryPart } from "@/lib/categories/rules";
import type { CategoryAssignments, CategoryRegistry } from "@/lib/contracts";
import { categoryHref, languageHref, type CategoryLink } from "@/lib/repo-page";

export const RANKING_CATEGORY_EXIT_LIMIT = 6;
export const RANKING_CATEGORY_LEAD_LIMIT = 18;

export type RankingCategoryLead = {
  id?: number | null;
  language?: string | null;
};

/** Public category exits from the leading ranking rows. Registry-public only — no facet UI. */
export function rankingCategoryExits(
  leading: readonly RankingCategoryLead[],
  registry: CategoryRegistry | null,
  assignments: CategoryAssignments | null = null,
  limit = RANKING_CATEGORY_EXIT_LIMIT,
): CategoryLink[] {
  if (!registry || leading.length === 0) return [];

  const publicById = new Map(
    registry.dimensions.flatMap((dimension) =>
      dimension.categories.filter((category) => category.public).map((category) => [category.id, category] as const),
    ),
  );
  const counts = new Map<string, { link: CategoryLink; count: number }>();
  const bump = (link: CategoryLink) => {
    if (!publicById.has(link.id)) return;
    const existing = counts.get(link.id);
    if (existing) existing.count += 1;
    else counts.set(link.id, { link, count: 1 });
  };

  for (const row of leading.slice(0, RANKING_CATEGORY_LEAD_LIMIT)) {
    if (row.language?.trim()) {
      const slug = slugifyCategoryPart(row.language);
      bump({ id: `language/${slug}`, label: row.language, href: languageHref(row.language) });
    }
    const assignment = row.id != null ? assignments?.repositories[String(row.id)] : undefined;
    if (!assignment) continue;
    for (const dimension of ["language", "ecosystem"] as const) {
      for (const id of assignment[dimension]) {
        const category = publicById.get(id);
        if (!category) continue;
        bump({
          id: category.id,
          label: category.label,
          href: categoryHref(category.dimension, category.slug),
        });
      }
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.link.id.localeCompare(b.link.id))
    .slice(0, limit)
    .map((entry) => entry.link);
}
