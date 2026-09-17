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
  type CategoryAssignmentsIndex as CategoryAssignmentsIndexData,
  type CategoryAssignmentsShard as CategoryAssignmentsShardData,
} from "@/lib/contracts";
import { isCloudflareWorkersHost } from "@/lib/runtime-config";
import {
  assembleCategoryAssignments,
  assembleCategoryAssignmentsPartial,
  categoryAssignmentShardBucketsForRepoIds,
  categoryAssignmentsShardPath,
  isCategoryAssignmentsIndex,
} from "./category-assignment-shards";
import { mapLimit } from "./map-limit";
import { DAILY_BASE_VIEW_OPTS, readAuthoritativeView, readView, type ViewOpts } from "./source";

/** Max parallel assignment-shard Blob/R2 GETs. CF Workers counts each as a subrequest. */
export const CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY = 6;
/** Tighter cap on OpenNext (`HOSTING_TARGET=cf`) so /rankings stays under the invocation budget. */
export const CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF = 4;

export function categoryAssignmentShardReadConcurrency(
  env: Parameters<typeof isCloudflareWorkersHost>[0] = process.env,
): number {
  return isCloudflareWorkersHost(env)
    ? CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF
    : CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY;
}

type AssignmentReader = typeof readView | typeof readAuthoritativeView;

export type LoadCategoryAssignmentsOptions = {
  /** When set, only those repo-id buckets are fetched. Full assemble when omitted. */
  repoIds?: readonly number[];
};

type AssignmentsMemo = { key: string; value: CategoryAssignmentsData };
let assembledAssignmentsMemo: AssignmentsMemo | null = null;

export function resetCategoryAssignmentsMemoForTests(): void {
  assembledAssignmentsMemo = null;
}

function assignmentMemoKey(index: CategoryAssignmentsIndexData): string {
  return `${index.rules_version}\0${index.generated_at}`;
}

function selectedAssignmentBuckets(shardCount: number, repoIds?: readonly number[]): number[] {
  if (repoIds == null) return Array.from({ length: shardCount }, (_, bucket) => bucket);
  return categoryAssignmentShardBucketsForRepoIds(repoIds, shardCount);
}

export async function loadCategoryAssignments(
  read: AssignmentReader,
  opts: ViewOpts,
  missingShards: "omit" | "throw",
  selection?: LoadCategoryAssignmentsOptions,
): Promise<CategoryAssignmentsData | null> {
  const document = await read("categories/assignments.json", CategoryAssignmentsDocument, opts);
  if (document === null) return null;
  // v1 monolith (or any non-index document): one GET, no shard fan-out. Prefer this on CF when Blob still has it.
  if (!isCategoryAssignmentsIndex(document)) return CategoryAssignments.parse(document);

  const buckets = selectedAssignmentBuckets(document.shard_count, selection?.repoIds);
  if (buckets.length === 0) {
    return CategoryAssignments.parse({
      rules_version: document.rules_version,
      generated_at: document.generated_at,
      repositories: {},
    });
  }

  const fullLoad = buckets.length === document.shard_count;
  const memoKey = assignmentMemoKey(document);
  if (fullLoad && assembledAssignmentsMemo?.key === memoKey) {
    return assembledAssignmentsMemo.value;
  }

  const shards = await mapLimit(buckets, categoryAssignmentShardReadConcurrency(), (bucket) =>
    read(categoryAssignmentsShardPath(bucket), CategoryAssignmentsShard, opts),
  );
  const missing = shards.flatMap((shard, index) => (shard === null ? [buckets[index] as number] : []));
  if (missing.length > 0) {
    if (missingShards === "throw") {
      throw new Error(`categories/assignments missing shard bucket(s) ${missing.join(",")}`);
    }
    return null;
  }
  const present = shards.map((shard) => {
    if (shard === null) throw new Error("categories/assignments shard disappeared after presence check");
    return shard;
  }) as CategoryAssignmentsShardData[];

  if (fullLoad) {
    const assembled = assembleCategoryAssignments(document, present);
    assembledAssignmentsMemo = { key: memoKey, value: assembled };
    return assembled;
  }
  return assembleCategoryAssignmentsPartial(document, present);
}

export const getCategoryRegistry = cache(() => readView("categories/registry.json", CategoryRegistry, DAILY_BASE_VIEW_OPTS));
export const getCategoriesLookup = cache(() => readView("lookup/categories.json", CategoriesLookup, DAILY_BASE_VIEW_OPTS));
export const getCategoryAssignments = cache(() => loadCategoryAssignments(readView, DAILY_BASE_VIEW_OPTS, "omit"));
export const getCategoryAssignmentsAuthoritative = () =>
  loadCategoryAssignments(readAuthoritativeView, { base: true }, "throw");

/** Rankings / category-exit paths: fetch only the shards that contain these repo ids. */
export function getCategoryAssignmentsForRepos(repoIds: readonly number[]) {
  return loadCategoryAssignments(readView, DAILY_BASE_VIEW_OPTS, "omit", { repoIds });
}

export const getCategoryAllTime = cache((dimension: string, slug: string) =>
  readView(categoryAllTimeRankPath(dimension, slug), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);

export const getCategoryAllTimePage = cache((dimension: string, slug: string, page: number) =>
  readView(categoryAllTimeRankPath(dimension, slug, page), CategoryRankList, DAILY_BASE_VIEW_OPTS),
);
