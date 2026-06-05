import { z } from "zod";
import { Period, RankItem, Window } from "./common";

export const CategoryDimension = z.enum([
  "language",
  "language_family",
  "domain",
  "project_type",
  "ecosystem",
  "owner_kind",
  "maturity",
]);
export type CategoryDimension = z.infer<typeof CategoryDimension>;

export const CategoryId = z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/);
export type CategoryId = z.infer<typeof CategoryId>;

export const CategoryRegistryEntry = z.object({
  id: CategoryId,
  dimension: CategoryDimension,
  slug: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string(),
  description: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  count: z.number().int().nonnegative(),
  public: z.boolean(),
  sitemap: z.boolean(),
  minimum_repo_count: z.number().int().nonnegative(),
});
export type CategoryRegistryEntry = z.infer<typeof CategoryRegistryEntry>;

export const CategoryDimensionRegistry = z.object({
  id: CategoryDimension,
  label: z.string(),
  description: z.string().optional(),
  categories: z.array(CategoryRegistryEntry),
});
export type CategoryDimensionRegistry = z.infer<typeof CategoryDimensionRegistry>;

export const CategoryRegistry = z.object({
  rules_version: z.string(),
  generated_at: z.string(),
  dimensions: z.array(CategoryDimensionRegistry),
});
export type CategoryRegistry = z.infer<typeof CategoryRegistry>;

export const RepositoryCategoryAssignment = z.object({
  language: z.array(CategoryId),
  language_family: z.array(CategoryId),
  domain: z.array(CategoryId),
  project_type: z.array(CategoryId),
  ecosystem: z.array(CategoryId),
  owner_kind: z.array(CategoryId),
  maturity: z.array(CategoryId),
});
export type RepositoryCategoryAssignment = z.infer<typeof RepositoryCategoryAssignment>;

export const CategoryAssignments = z.object({
  rules_version: z.string(),
  generated_at: z.string(),
  repositories: z.record(z.string(), RepositoryCategoryAssignment),
});
export type CategoryAssignments = z.infer<typeof CategoryAssignments>;

export const CategoriesLookup = z.object({
  rules_version: z.string(),
  generated_at: z.string(),
  dimensions: z.array(
    z.object({
      id: CategoryDimension,
      label: z.string(),
      categories: z.array(
        z.object({
          id: CategoryId,
          slug: z.string(),
          label: z.string(),
          count: z.number().int().nonnegative(),
          sitemap: z.boolean().optional(),
        }),
      ),
    }),
  ),
});
export type CategoriesLookup = z.infer<typeof CategoriesLookup>;

export const CategoryRankMetric = z.enum(["flow", "stock"]);
export type CategoryRankMetric = z.infer<typeof CategoryRankMetric>;

export const CategoryRankList = z.object({
  meta: z.object({
    window: Window,
    period: Period,
    dim: z.literal("repo"),
    metric: CategoryRankMetric,
    generated_at: z.string(),
    category: z.object({
      id: CategoryId,
      dimension: CategoryDimension,
      slug: z.string(),
    }),
  }),
  items: z.array(RankItem),
});
export type CategoryRankList = z.infer<typeof CategoryRankList>;
