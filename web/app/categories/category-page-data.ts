import {
  CATEGORY_DIMENSIONS,
  PRIORITY_LANGUAGE_SLUGS,
  STATIC_CATEGORY_DEFINITIONS,
  categoryId,
  type CategoryDimension,
} from "@/lib/categories/rules";
import type { CategoriesLookup, CategoryRegistry, CategoryRegistryEntry } from "@/lib/contracts";

export const CATEGORY_REVALIDATE_SECONDS = 60;
export const CATEGORY_INDEX_PREVIEW_LIMIT = 10;

export function isCategoryDimension(value: string): value is CategoryDimension {
  return (CATEGORY_DIMENSIONS as readonly string[]).includes(value);
}

export function categoryPath(dimension: string, slug?: string): string {
  return slug ? `/categories/${dimension}/${slug}` : `/categories/${dimension}`;
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

export function publicCategoriesForDimension(dimension: { categories: CategoryRegistryEntry[] }): CategoryRegistryEntry[] {
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

export function publicCategoryStaticParams(registry?: CategoryRegistry | null) {
  const params = registry
    ? publicCategoryEntries(registry).map((category) => ({ dimension: category.dimension, slug: category.slug }))
    : [];
  return uniqueCategoryParams([...priorityLanguageStaticParams(), ...params]);
}

function uniqueCategoryParams(params: Array<{ dimension: string; slug: string }>) {
  const seen = new Set<string>();
  return params.filter((param) => {
    const key = `${param.dimension}/${param.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sitemapCategoryPaths(categories?: CategoriesLookup | null): string[] {
  const paths = ["/categories", "/categories/language"];
  if (!categories) return paths;
  for (const dimension of categories.dimensions) {
    paths.push(categoryPath(dimension.id));
    for (const category of dimension.categories) {
      if (category.sitemap !== false) paths.push(categoryPath(dimension.id, category.slug));
    }
  }
  return [...new Set(paths)].sort();
}
