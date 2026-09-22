import {
  CATEGORY_DIMENSIONS,
  CATEGORY_RULES_VERSION,
  STATIC_CATEGORY_DEFINITIONS,
  categoryId,
  classifyRepository,
  definitionMinimumRepoCount,
  labelFromSlug,
  languageCategoriesFromRepository,
  type CategoryAssignment,
  type CategoryDefinition,
  type CategoryDimension,
} from "@/lib/categories/rules";
import { CATEGORY_ASSIGNMENT_SCHEMA_VERSION, CATEGORY_ASSIGNMENT_SHARD_COUNT } from "@/lib/contracts/categories";
import { CATEGORY_RANK_PAGE_SIZE, categoryAllTimeRankPath } from "@/lib/categories/rank-pages";
import type { CategoryRegistry, CategoryRegistryEntry } from "@/lib/contracts/categories";
import { categoryAssignmentsPublicationArtifacts } from "@/lib/data/category-assignment-shards";
import type { Model, Period, RepoMeta } from "./model";

const DIMENSION_LABELS: Record<CategoryDimension, string> = {
  language: "Language",
  language_family: "Language Family",
  domain: "Domain",
  project_type: "Project Type",
  ecosystem: "Ecosystem",
  owner_kind: "Owner Kind",
  maturity: "Maturity",
};

interface CategoryRankView {
  meta: {
    window: "all";
    period: Period;
    dim: "repo";
    metric: "stock";
    generated_at: string;
    category: { id: string; dimension: CategoryDimension; slug: string };
  };
  items: Array<{ rank: number; id: number; value: number; prev_rank: number | null }>;
}

interface BuiltAssignments {
  payload: {
    rules_version: string;
    generated_at: string;
    repositories: Record<string, CategoryAssignment>;
  };
  repoCategories: Map<number, Set<string>>;
  categoryRepos: Map<string, Set<number>>;
  counts: Map<string, number>;
  languageLabels: Map<string, string>;
}

function splitCategoryId(id: string): { dimension: CategoryDimension; slug: string } {
  const [dimension, slug] = id.split("/") as [CategoryDimension, string];
  return { dimension, slug };
}

function buildAssignments(model: Model, generatedAt: string): BuiltAssignments {
  const repositories: Record<string, CategoryAssignment> = {};
  const repoCategories = new Map<number, Set<string>>();
  const categoryRepos = new Map<string, Set<number>>();
  const counts = new Map<string, number>();
  const languageLabels = new Map<string, string>();

  // Categories are a current discovery surface. Historical repositories stay
  // reachable through entity/search views but no longer affect current counts
  // or all-time category rankings.
  for (const id of model.activeIds) {
    const repo = model.repos.get(id)!;
    for (const language of languageCategoriesFromRepository(repo)) languageLabels.set(language.slug, language.label);

    const assignment = classifyRepository(repo, { generatedAt });
    repositories[String(id)] = assignment;

    const categorySet = new Set<string>();
    for (const dimension of CATEGORY_DIMENSIONS) {
      for (const category of assignment[dimension]) {
        categorySet.add(category);
        counts.set(category, (counts.get(category) ?? 0) + 1);
        let repos = categoryRepos.get(category);
        if (!repos) categoryRepos.set(category, (repos = new Set()));
        repos.add(id);
      }
    }
    repoCategories.set(id, categorySet);
  }

  return {
    payload: { rules_version: CATEGORY_RULES_VERSION, generated_at: generatedAt, repositories },
    repoCategories,
    categoryRepos,
    counts,
    languageLabels,
  };
}

function definitionMap(languageLabels: Map<string, string>, counts: Map<string, number>): Map<string, CategoryDefinition> {
  const defs = new Map<string, CategoryDefinition>();
  for (const def of STATIC_CATEGORY_DEFINITIONS) defs.set(categoryId(def.dimension, def.slug), def);

  for (const id of counts.keys()) {
    if (defs.has(id)) continue;
    const { dimension, slug } = splitCategoryId(id);
    const label = dimension === "language" ? languageLabels.get(slug) ?? labelFromSlug(slug) : labelFromSlug(slug);
    defs.set(id, { dimension, slug, label, order: 5_000 });
  }

  return defs;
}

function buildRegistry(
  generatedAt: string,
  assignments: BuiltAssignments,
): { registry: CategoryRegistry; publicCategories: CategoryRegistryEntry[] } {
  const defs = definitionMap(assignments.languageLabels, assignments.counts);
  const publicCategories: CategoryRegistryEntry[] = [];

  const dimensions = CATEGORY_DIMENSIONS.map((dimension) => {
    const categories = [...defs.values()]
      .filter((def) => def.dimension === dimension)
      .map((def): CategoryRegistryEntry => {
        const id = categoryId(def.dimension, def.slug);
        const count = assignments.counts.get(id) ?? 0;
        const minimum = definitionMinimumRepoCount(def);
        const isPublic = def.public !== false && count > 0 && (def.curated || count >= minimum);
        const entry: CategoryRegistryEntry = {
          id,
          dimension: def.dimension,
          slug: def.slug,
          label: def.label,
          count,
          public: isPublic,
          sitemap: isPublic && def.sitemap !== false,
          minimum_repo_count: minimum,
        };
        if (def.description) entry.description = def.description;
        if (def.aliases?.length) entry.aliases = def.aliases;
        if (entry.public) publicCategories.push(entry);
        return entry;
      })
      .sort((a, b) => {
        const ao = defs.get(a.id)?.order ?? 5_000;
        const bo = defs.get(b.id)?.order ?? 5_000;
        return ao - bo || b.count - a.count || a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
      });

    return { id: dimension, label: DIMENSION_LABELS[dimension], categories };
  });

  return {
    registry: { rules_version: CATEGORY_RULES_VERSION, generated_at: generatedAt, dimensions },
    publicCategories,
  };
}

function buildCategoriesLookup(registry: CategoryRegistry) {
  return {
    rules_version: registry.rules_version,
    generated_at: registry.generated_at,
    dimensions: registry.dimensions.map((dimension) => ({
      id: dimension.id,
      label: dimension.label,
      categories: dimension.categories
        .filter((category) => category.public)
        .map((category) => ({
          id: category.id,
          slug: category.slug,
          label: category.label,
          count: category.count,
          sitemap: category.sitemap,
        })),
    })),
  };
}

function categoryAllTimeRankViewsFromStars(
  category: CategoryRegistryEntry,
  rows: Array<{ id: number; stars: number }>,
  generatedAt: string,
): Array<{ path: string; view: CategoryRankView }> {
  const items = [...rows]
    .sort((a, b) => b.stars - a.stars || a.id - b.id)
    .map((row, i) => ({ rank: i + 1, id: row.id, value: row.stars, prev_rank: null }));
  if (items.length === 0) return [];

  const pages: Array<{ path: string; view: CategoryRankView }> = [];
  for (let offset = 0; offset < items.length; offset += CATEGORY_RANK_PAGE_SIZE) {
    const page = offset / CATEGORY_RANK_PAGE_SIZE + 1;
    pages.push({
      path: categoryAllTimeRankPath(category.dimension, category.slug, page),
      view: {
        meta: {
          window: "all",
          period: "all",
          dim: "repo",
          metric: "stock",
          generated_at: generatedAt,
          category: { id: category.id, dimension: category.dimension, slug: category.slug },
        },
        items: items.slice(offset, offset + CATEGORY_RANK_PAGE_SIZE),
      },
    });
  }
  return pages;
}

export function categoryIdsOf(assignment: CategoryAssignment): string[] {
  const ids: string[] = [];
  for (const dimension of CATEGORY_DIMENSIONS) ids.push(...assignment[dimension]);
  return ids;
}

export function classifyActiveRepo(repo: RepoMeta, generatedAt: string): {
  assignment: CategoryAssignment;
  categoryIds: string[];
  languageLabels: Array<{ slug: string; label: string }>;
} | null {
  if (repo.active === false) return null;
  const languageLabels = languageCategoriesFromRepository(repo).map((language) => ({
    slug: language.slug,
    label: language.label,
  }));
  const assignment = classifyRepository(repo, { generatedAt });
  return { assignment, categoryIds: categoryIdsOf(assignment), languageLabels };
}

export function categoryAssignmentShardDocument(
  bucket: number,
  generatedAt: string,
  repositories: Record<string, CategoryAssignment>,
) {
  return {
    schema_version: CATEGORY_ASSIGNMENT_SCHEMA_VERSION,
    bucket,
    rules_version: CATEGORY_RULES_VERSION,
    generated_at: generatedAt,
    repositories,
  };
}

export function categoryAssignmentsIndexDocument(generatedAt: string) {
  return {
    schema_version: CATEGORY_ASSIGNMENT_SCHEMA_VERSION,
    rules_version: CATEGORY_RULES_VERSION,
    generated_at: generatedAt,
    shard_count: CATEGORY_ASSIGNMENT_SHARD_COUNT,
  };
}

export function categoryViewsFromAggregates(
  generatedAt: string,
  counts: Map<string, number>,
  languageLabels: Map<string, string>,
  members: Map<string, Array<{ id: number; stars: number }>>,
): Map<string, unknown> {
  const views = new Map<string, unknown>();
  const { registry, publicCategories } = buildRegistry(generatedAt, {
    payload: { rules_version: CATEGORY_RULES_VERSION, generated_at: generatedAt, repositories: {} },
    repoCategories: new Map(),
    categoryRepos: new Map(),
    counts,
    languageLabels,
  });
  views.set("categories/registry.json", registry);
  views.set("lookup/categories.json", buildCategoriesLookup(registry));
  for (const category of publicCategories) {
    const rows = members.get(category.id);
    if (!rows?.length) continue;
    for (const { path, view } of categoryAllTimeRankViewsFromStars(category, rows, generatedAt)) views.set(path, view);
  }
  return views;
}

export function computeCategoryViews(model: Model, generatedAt: string): Map<string, unknown> {
  const assignments = buildAssignments(model, generatedAt);
  const counts = assignments.counts;
  const members = new Map<string, Array<{ id: number; stars: number }>>();
  for (const [category, repoIds] of assignments.categoryRepos) {
    const rows: Array<{ id: number; stars: number }> = [];
    for (const id of repoIds) {
      const repo = model.repos.get(id);
      if (!repo) continue;
      rows.push({ id, stars: repo.current_stars });
    }
    members.set(category, rows);
  }
  const views = categoryViewsFromAggregates(generatedAt, counts, assignments.languageLabels, members);
  for (const { path, data } of categoryAssignmentsPublicationArtifacts(assignments.payload)) {
    views.set(path, data);
  }
  return views;
}
