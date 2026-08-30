import { cache } from "react";
import { categoryAllTimeRankPath } from "@/lib/categories/rank-pages";
import {
  CategoriesLookup,
  CategoryAssignments,
  CategoryAssignmentsDocument,
  CategoryAssignmentsShard,
  CategoryRankList,
  CategoryRegistry,
  type CategoryAssignments as CategoryAssignmentsData,
} from "@/lib/contracts";
import {
  assembleCategoryAssignments,
  categoryAssignmentsShardPath,
  isCategoryAssignmentsIndex,
} from "./category-assignment-shards";
import { DAILY_BASE_VIEW_OPTS, readAuthoritativeView, readView, type ViewOpts } from "./source";

async function loadCategoryAssignments(
  read: typeof readView | typeof readAuthoritativeView,
  opts: ViewOpts,
  missingShards: "omit" | "throw",
): Promise<CategoryAssignmentsData | null> {
  const document = await read("categories/assignments.json", CategoryAssignmentsDocument, opts);
  if (document === null) return null;
  if (!isCategoryAssignmentsIndex(document)) return CategoryAssignments.parse(document);

  const shards = await Promise.all(
    Array.from({ length: document.shard_count }, (_, bucket) =>
      read(categoryAssignmentsShardPath(bucket), CategoryAssignmentsShard, opts),
    ),
  );
  const missing = shards.flatMap((shard, bucket) => (shard === null ? [bucket] : []));
  if (missing.length > 0) {
    if (missingShards === "throw") {
      throw new Error(`categories/assignments missing shard bucket(s) ${missing.join(",")}`);
    }
    return null;
  }
  return assembleCategoryAssignments(
    document,
    shards.map((shard) => {
      if (shard === null) throw new Error("categories/assignments shard disappeared after presence check");
      return shard;
    }),
  );
}

export const getCategoryRegistry = cache(() => readView("categories/registry.json", CategoryRegistry, DAILY_BASE_VIEW_OPTS));
export const getCategoriesLookup = cache(() => readView("lookup/categories.json", CategoriesLookup, DAILY_BASE_VIEW_OPTS));
export const getCategoryAssignments = cache(() => loadCategoryAssignments(readView, DAILY_BASE_VIEW_OPTS, "omit"));
export const getCategoryAssignmentsAuthoritative = () =>
  loadCategoryAssignments(readAuthoritativeView, { base: true }, "throw");

export const getCategoryAllTime = cache((dimension: string, slug: string) =>
  readView(categoryAllTimeRankPath(dimension, slug), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);

export const getCategoryAllTimePage = cache((dimension: string, slug: string, page: number) =>
  readView(categoryAllTimeRankPath(dimension, slug, page), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);
