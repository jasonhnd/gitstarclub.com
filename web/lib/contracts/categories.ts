import { z } from "zod";
import { NonNegativeInt, Period, RankItem, SafeText, TimestampStr, Window } from "./common";

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
  label: SafeText,
  description: SafeText.optional(),
  aliases: z.array(SafeText).optional(),
  count: NonNegativeInt,
  public: z.boolean(),
  sitemap: z.boolean(),
  minimum_repo_count: NonNegativeInt,
}).strict();
export type CategoryRegistryEntry = z.infer<typeof CategoryRegistryEntry>;

export const CategoryDimensionRegistry = z.object({
  id: CategoryDimension,
  label: SafeText,
  description: SafeText.optional(),
  categories: z.array(CategoryRegistryEntry),
}).strict();
export type CategoryDimensionRegistry = z.infer<typeof CategoryDimensionRegistry>;

export const CategoryRegistry = z.object({
  rules_version: SafeText,
  generated_at: TimestampStr,
  dimensions: z.array(CategoryDimensionRegistry),
}).strict();
export type CategoryRegistry = z.infer<typeof CategoryRegistry>;

export const RepositoryCategoryAssignment = z.object({
  language: z.array(CategoryId),
  language_family: z.array(CategoryId),
  domain: z.array(CategoryId),
  project_type: z.array(CategoryId),
  ecosystem: z.array(CategoryId),
  owner_kind: z.array(CategoryId).length(1),
  maturity: z.array(CategoryId),
}).strict();
export type RepositoryCategoryAssignment = z.infer<typeof RepositoryCategoryAssignment>;

export const CategoryAssignments = z.object({
  rules_version: SafeText,
  generated_at: TimestampStr,
  repositories: z.record(z.string(), RepositoryCategoryAssignment),
}).strict();
export type CategoryAssignments = z.infer<typeof CategoryAssignments>;

export const CategoriesLookup = z.object({
  rules_version: SafeText,
  generated_at: TimestampStr,
  dimensions: z.array(
    z.object({
      id: CategoryDimension,
      label: SafeText,
      categories: z.array(
        z.object({
          id: CategoryId,
          slug: z.string().regex(/^[a-z0-9-]+$/),
          label: SafeText,
          count: NonNegativeInt,
          sitemap: z.boolean().optional(),
        }).strict(),
      ),
    }).strict(),
  ),
}).strict();
export type CategoriesLookup = z.infer<typeof CategoriesLookup>;

export const CategoryRankMetric = z.enum(["flow", "stock"]);
export type CategoryRankMetric = z.infer<typeof CategoryRankMetric>;

export const CategoryRankList = z.object({
  meta: z.object({
    window: Window,
    period: Period,
    dim: z.literal("repo"),
    metric: CategoryRankMetric,
    generated_at: TimestampStr,
    category: z.object({
      id: CategoryId,
      dimension: CategoryDimension,
      slug: z.string().regex(/^[a-z0-9-]+$/),
    }).strict(),
  }).strict(),
  items: z.array(RankItem),
}).strict().superRefine((rank, ctx) => {
  for (let i = 0; i < rank.items.length; i++) {
    if (rank.items[i].id == null) {
      ctx.addIssue({ code: "custom", path: ["items", i], message: "category rank items require repo id" });
    }
  }
});
export type CategoryRankList = z.infer<typeof CategoryRankList>;
