import type { CategoryAssignments, CategoryRegistry, RepoLookupEntry } from "@/lib/contracts";
import { CATEGORY_DIMENSIONS, categoryLanguageNamesFromRepository, slugifyCategoryPart } from "@/lib/categories/rules";

export type RepoLanguage = { name: string; size?: number | null; color?: string | null };
export type RepoCategoryLink = { id: string; label: string; href: string };
export type RelatedRepo = Pick<RepoLookupEntry, "full_name" | "owner" | "name" | "language" | "current_stars">;

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
): RepoCategoryLink[] {
  const links = new Map<string, RepoCategoryLink>();
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

export function relatedRepositories(
  repo: { full_name: string; owner: string; language: string | null },
  lookup: Record<string, RepoLookupEntry> | null,
  limit = 6,
): RelatedRepo[] {
  if (!lookup) return [];
  const rows = Object.values(lookup).filter((entry) => entry.full_name !== repo.full_name);
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
