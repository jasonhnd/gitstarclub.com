import { cache } from "react";
import { CategoriesLookup, CategoryAssignments, CategoryRankList, CategoryRegistry } from "@/lib/contracts";
import { DAILY_BASE_VIEW_OPTS, readView } from "./source";

export const getCategoryRegistry = cache(() => readView("categories/registry.json", CategoryRegistry, DAILY_BASE_VIEW_OPTS));
export const getCategoriesLookup = cache(() => readView("lookup/categories.json", CategoriesLookup, DAILY_BASE_VIEW_OPTS));
export const getCategoryAssignments = cache(() => readView("categories/assignments.json", CategoryAssignments, DAILY_BASE_VIEW_OPTS));

export const getCategoryAllTime = cache((dimension: string, slug: string) =>
  readView(`rank/category/${dimension}/${slug}/all-time/repo/stock.json`, CategoryRankList, DAILY_BASE_VIEW_OPTS),
);
