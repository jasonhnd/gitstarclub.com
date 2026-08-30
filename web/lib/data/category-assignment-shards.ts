import {
  CATEGORY_ASSIGNMENT_SCHEMA_VERSION,
  CATEGORY_ASSIGNMENT_SHARD_COUNT,
  CategoryAssignments,
  CategoryAssignmentsIndex,
  CategoryAssignmentsShard,
  type CategoryAssignments as CategoryAssignmentsData,
  type CategoryAssignmentsIndex as CategoryAssignmentsIndexData,
  type CategoryAssignmentsShard as CategoryAssignmentsShardData,
} from "@/lib/contracts";

export const CATEGORY_ASSIGNMENTS_INDEX_PATH = "categories/assignments.json";
export const categoryAssignmentsShardPath = (bucket: number): string =>
  `categories/assignments/shards/${bucket}.json`;

function repoShard(id: number): number {
  return id % CATEGORY_ASSIGNMENT_SHARD_COUNT;
}

export type CategoryAssignmentsShardArtifact = { path: string; data: CategoryAssignmentsShardData };

export function isCategoryAssignmentsIndex(value: unknown): value is CategoryAssignmentsIndexData {
  return CategoryAssignmentsIndex.safeParse(value).success;
}

export function splitCategoryAssignments(assignments: CategoryAssignmentsData): {
  index: CategoryAssignmentsIndexData;
  shards: CategoryAssignmentsShardArtifact[];
} {
  const parsed = CategoryAssignments.parse(assignments);
  const buckets: CategoryAssignmentsShardData[] = Array.from({ length: CATEGORY_ASSIGNMENT_SHARD_COUNT }, (_, bucket) =>
    CategoryAssignmentsShard.parse({
      schema_version: CATEGORY_ASSIGNMENT_SCHEMA_VERSION,
      bucket,
      rules_version: parsed.rules_version,
      generated_at: parsed.generated_at,
      repositories: {},
    }),
  );

  for (const [id, assignment] of Object.entries(parsed.repositories)) {
    buckets[repoShard(Number(id))].repositories[id] = assignment;
  }

  return {
    index: CategoryAssignmentsIndex.parse({
      schema_version: CATEGORY_ASSIGNMENT_SCHEMA_VERSION,
      rules_version: parsed.rules_version,
      generated_at: parsed.generated_at,
      shard_count: CATEGORY_ASSIGNMENT_SHARD_COUNT,
    }),
    shards: buckets.map((data) => ({ path: categoryAssignmentsShardPath(data.bucket), data })),
  };
}

export function assembleCategoryAssignments(
  index: CategoryAssignmentsIndexData,
  shards: readonly CategoryAssignmentsShardData[],
): CategoryAssignmentsData {
  const parsedIndex = CategoryAssignmentsIndex.parse(index);
  if (shards.length !== parsedIndex.shard_count) {
    throw new Error(
      `categories/assignments expected ${parsedIndex.shard_count} shards, received ${shards.length}`,
    );
  }
  const repositories: CategoryAssignmentsData["repositories"] = {};
  const seen = new Set<number>();
  for (const shard of shards) {
    const parsed = CategoryAssignmentsShard.parse(shard);
    if (seen.has(parsed.bucket)) throw new Error(`categories/assignments duplicate shard bucket ${parsed.bucket}`);
    seen.add(parsed.bucket);
    if (parsed.rules_version !== parsedIndex.rules_version) {
      throw new Error(`categories/assignments shard ${parsed.bucket} rules_version mismatch`);
    }
    Object.assign(repositories, parsed.repositories);
  }
  if (seen.size !== parsedIndex.shard_count) {
    const missing = Array.from({ length: parsedIndex.shard_count }, (_, bucket) => bucket).filter(
      (bucket) => !seen.has(bucket),
    );
    throw new Error(`categories/assignments missing shard bucket(s) ${missing.join(",")}`);
  }
  return CategoryAssignments.parse({
    rules_version: parsedIndex.rules_version,
    generated_at: parsedIndex.generated_at,
    repositories,
  });
}

export function categoryAssignmentsPublicationArtifacts(
  assignments: CategoryAssignmentsData,
): Array<{ path: string; data: unknown }> {
  const { index, shards } = splitCategoryAssignments(assignments);
  return [{ path: CATEGORY_ASSIGNMENTS_INDEX_PATH, data: index }, ...shards];
}
