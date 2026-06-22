import { cache } from "react";
import { CategoriesLookup, CategoryAssignments, CategoryRankList, CategoryRegistry } from "@/lib/contracts";
import { readView } from "./source";

export const getCategoryRegistry = cache(() => readView("categories/registry.json", CategoryRegistry, { base: true }));
export const getCategoriesLookup = cache(() => readView("lookup/categories.json", CategoriesLookup, { base: true }));
export const getCategoryAssignments = cache(() => readView("categories/assignments.json", CategoryAssignments, { base: true }));

export const getCategoryAllTime = cache((dimension: string, slug: string) =>
  readView(`rank/category/${dimension}/${slug}/all-time/repo/stock.json`, CategoryRankList, { base: true }),
);
