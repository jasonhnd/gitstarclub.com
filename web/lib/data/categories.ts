import { cache } from "react";
import { categoryAllTimeRankPath } from "@/lib/categories/rank-pages";
import { CategoriesLookup, CategoryAssignments, CategoryRankList, CategoryRegistry } from "@/lib/contracts";
import { DAILY_BASE_VIEW_OPTS, readView } from "./source";

export const getCategoryRegistry = cache(() => readView("categories/registry.json", CategoryRegistry, DAILY_BASE_VIEW_OPTS));
export const getCategoriesLookup = cache(() => readView("lookup/categories.json", CategoriesLookup, DAILY_BASE_VIEW_OPTS));
export const getCategoryAssignments = cache(() => readView("categories/assignments.json", CategoryAssignments, DAILY_BASE_VIEW_OPTS));

export const getCategoryAllTime = cache((dimension: string, slug: string) =>
  readView(categoryAllTimeRankPath(dimension, slug), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);

export const getCategoryAllTimePage = cache((dimension: string, slug: string, page: number) =>
  readView(categoryAllTimeRankPath(dimension, slug, page), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);
