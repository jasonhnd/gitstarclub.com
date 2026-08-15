import {
  CATEGORY_DIMENSIONS,
  PRIORITY_LANGUAGE_SLUGS,
  STATIC_CATEGORY_DEFINITIONS,
  categoryId,
  type CategoryDimension,
} from "@/lib/categories/rules";
import type { CategoryRegistry, CategoryRegistryEntry } from "@/lib/contracts";

export const CATEGORY_INDEX_PREVIEW_LIMIT = 10;
export const RELATED_PUBLIC_CATEGORY_LIMIT = 8;
/** Registry counts at or below this are a thin slice and must not read as a complete GitHub catalog. */
export const THIN_CATEGORY_REPO_COUNT = 24;

export function isCategoryDimension(value: string): value is CategoryDimension {
  return (CATEGORY_DIMENSIONS as readonly string[]).includes(value);
}

export function categoryPath(dimension: string, slug?: string): string {
  return slug ? `/categories/${dimension}/${slug}` : `/categories/${dimension}`;
}

export function categoryDetailPagePath(dimension: string, slug: string, page = 1): string {
  return page <= 1 ? categoryPath(dimension, slug) : `${categoryPath(dimension, slug)}/page/${page}`;
}

export function fallbackRegistry(): CategoryRegistry {
  return {
    rules_version: "fallback",
    generated_at: "fallback",
    dimensions: CATEGORY_DIMENSIONS.map((dimension) => ({
      id: dimension,
      label: dimensionLabel(dimension),
      categories: STATIC_CATEGORY_DEFINITIONS.filter((def) => def.dimension === dimension).map((def) => {
        const entry: CategoryRegistryEntry = {
          id: categoryId(def.dimension, def.slug),
          dimension: def.dimension,
          slug: def.slug,
          label: def.label,
          count: 0,
          public: def.public !== false && (def.curated || def.dimension === "language"),
          sitemap: false,
          minimum_repo_count: def.minimumRepoCount ?? 20,
        };
        if (def.description) entry.description = def.description;
        if (def.aliases?.length) entry.aliases = def.aliases;
        return entry;
      }),
    })),
  };
}

export function dimensionLabel(dimension: CategoryDimension): string {
  switch (dimension) {
    case "language":
      return "Language";
    case "language_family":
      return "Language Family";
    case "domain":
      return "Domain";
    case "project_type":
      return "Project Type";
    case "ecosystem":
      return "Ecosystem";
    case "owner_kind":
      return "Owner Kind";
    case "maturity":
      return "Maturity";
  }
}

export function publicCategoryEntries(registry: CategoryRegistry): CategoryRegistryEntry[] {
  return registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
}

export function isThinCategoryCount(count: number): boolean {
  return count > 0 && count <= THIN_CATEGORY_REPO_COUNT;
}

export function relatedPublicCategories(
  categories: readonly CategoryRegistryEntry[],
  currentId: string,
  limit = RELATED_PUBLIC_CATEGORY_LIMIT,
): CategoryRegistryEntry[] {
  return categories.filter((entry) => entry.public && entry.id !== currentId).slice(0, limit);
}

function publicCategoriesForDimension(dimension: { categories: CategoryRegistryEntry[] }): CategoryRegistryEntry[] {
  return dimension.categories.filter((category) => category.public);
}

export function publicDimensions(registry: CategoryRegistry) {
  return registry.dimensions
    .map((dimension) => ({ ...dimension, categories: publicCategoriesForDimension(dimension) }))
    .filter((dimension) => dimension.categories.length > 0);
}

export function findCategory(registry: CategoryRegistry, dimension: string, slug: string): CategoryRegistryEntry | null {
  if (!isCategoryDimension(dimension)) return null;
  return registry.dimensions.find((entry) => entry.id === dimension)?.categories.find((category) => category.slug === slug && category.public) ?? null;
}

export function findDimension(registry: CategoryRegistry, dimension: string) {
  if (!isCategoryDimension(dimension)) return null;
  return registry.dimensions.find((entry) => entry.id === dimension) ?? null;
}

export function priorityLanguageStaticParams() {
  return PRIORITY_LANGUAGE_SLUGS.map((slug) => ({ dimension: "language", slug }));
}
