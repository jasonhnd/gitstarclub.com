import { cache } from "react";
import { getCategoryAllTimePage } from "@/lib/data";
import { CATEGORY_DETAIL_PAGE_SIZE, pageCount } from "@/lib/pagination";
import { categoryPageAvailabilityKey } from "./rank-pages";

export type CategoryPaginationInput = {
  dimension: string;
  slug: string;
  count: number;
};

export type CategoryPageAvailability = {
  totalRows: number;
  availablePages: number[];
  totalPagesFromRegistry: number;
};

export type CategoryPageAvailabilityMap = Record<string, readonly number[]>;

export const resolveAvailableCategoryPages = cache(
  async (dimension: string, slug: string, totalRows: number): Promise<CategoryPageAvailability> => {
    const safeTotalRows = Math.max(0, totalRows);
    const totalPagesFromRegistry = pageCount(safeTotalRows, CATEGORY_DETAIL_PAGE_SIZE);

    if (safeTotalRows === 0) {
      return { totalRows: safeTotalRows, availablePages: [1], totalPagesFromRegistry };
    }

    const availablePages: number[] = [];
    for (let page = 1; page <= totalPagesFromRegistry; page++) {
      const rank = await getCategoryAllTimePage(dimension, slug, page);
      if (!rank || rank.items.length === 0) break;
      availablePages.push(page);
    }

    return { totalRows: safeTotalRows, availablePages, totalPagesFromRegistry };
  },
);

export async function resolveCategoryPageAvailabilityMap(categories: readonly CategoryPaginationInput[]): Promise<CategoryPageAvailabilityMap> {
  const entries = await Promise.all(
    categories.map(async (category) => {
      const availability = await resolveAvailableCategoryPages(category.dimension, category.slug, category.count);
      return [categoryPageAvailabilityKey(category.dimension, category.slug), availability.availablePages] as const;
    }),
  );

  return Object.fromEntries(entries);
}
