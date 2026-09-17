import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import {
  CATEGORY_ASSIGNMENT_SHARD_COUNT,
  CategoryAssignments,
  type CategoryAssignments as CategoryAssignmentsData,
  type CategoryAssignmentsIndex as CategoryAssignmentsIndexData,
} from "@/lib/contracts";
import {
  CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY,
  CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF,
  categoryAssignmentShardReadConcurrency,
  loadCategoryAssignments,
  resetCategoryAssignmentsMemoForTests,
  shouldSkipCategoryAssignmentShardFanOut,
} from "./categories";
import {
  categoryAssignmentsShardPath,
  splitCategoryAssignments,
} from "./category-assignment-shards";
import type { ViewOpts } from "./source";

const assignment = {
  language: ["language/python"],
  language_family: ["language_family/python"],
  domain: ["domain/ai-ml"],
  project_type: ["project_type/library"],
  ecosystem: ["ecosystem/python"],
  owner_kind: ["owner_kind/organization"],
  maturity: ["maturity/star-10k"],
};

const assignments = CategoryAssignments.parse({
  rules_version: "2026-06-05.1",
  generated_at: "2026-06-05T00:00:00.000Z",
  repositories: {
    "1": assignment,
    "32": { ...assignment, language: ["language/rust"], language_family: ["language_family/rust"] },
    "33": assignment,
  },
});

const { index, shards } = splitCategoryAssignments(assignments);
const shardByPath = new Map(shards.map((shard) => [shard.path, shard.data]));

const originalHostingTarget = process.env.HOSTING_TARGET;
const originalVercelEnv = process.env.VERCEL_ENV;

beforeEach(() => {
  resetCategoryAssignmentsMemoForTests();
  delete process.env.HOSTING_TARGET;
  delete process.env.VERCEL_ENV;
});

afterEach(() => {
  resetCategoryAssignmentsMemoForTests();
  if (originalHostingTarget === undefined) delete process.env.HOSTING_TARGET;
  else process.env.HOSTING_TARGET = originalHostingTarget;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("loadCategoryAssignments shard fan-out", () => {
  test("defaults concurrency to 6 and tightens to 4 on the CF Workers host", () => {
    expect(categoryAssignmentShardReadConcurrency({})).toBe(CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY);
    expect(categoryAssignmentShardReadConcurrency({ HOSTING_TARGET: "cf" })).toBe(
      CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF,
    );
    expect(categoryAssignmentShardReadConcurrency({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" })).toBe(
      CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY,
    );
  });

  test("never starts more than N shard reads at once on a 32-shard index", async () => {
    const { maxInFlight, shardReads, result } = await loadWithProbe();
    expect(maxInFlight).toBeLessThanOrEqual(CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY);
    expect(maxInFlight).toBe(CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY);
    expect(shardReads).toBe(CATEGORY_ASSIGNMENT_SHARD_COUNT);
    expect(result).toEqual(assignments);
  });

  test("CF host never starts more than the tighter shard concurrency", async () => {
    process.env.HOSTING_TARGET = "cf";
    const { maxInFlight, shardReads } = await loadWithProbe();
    expect(maxInFlight).toBeLessThanOrEqual(CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF);
    expect(maxInFlight).toBe(CATEGORY_ASSIGNMENT_SHARD_READ_CONCURRENCY_CF);
    expect(shardReads).toBe(CATEGORY_ASSIGNMENT_SHARD_COUNT);
  });

  test("v1 monolith is used as-is and starts no shard reads", async () => {
    const { maxInFlight, shardReads, result } = await loadWithProbe({ document: assignments });
    expect(shardReads).toBe(0);
    expect(maxInFlight).toBe(0);
    expect(result).toEqual(assignments);
  });

  test("repo-id selection only reads the unique buckets those ids need", async () => {
    const { maxInFlight, shardReads, paths, result } = await loadWithProbe({ repoIds: [1, 33, 32] });
    expect(paths.filter((path) => path.includes("/shards/")).sort()).toEqual([
      categoryAssignmentsShardPath(0),
      categoryAssignmentsShardPath(1),
    ]);
    expect(shardReads).toBe(2);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result?.repositories["1"]?.language).toEqual(["language/python"]);
    expect(result?.repositories["32"]?.language).toEqual(["language/rust"]);
    expect(result?.repositories["33"]?.language).toEqual(["language/python"]);
  });

  test("CF host skips rankings-style repo-id selection with 0 shard reads", async () => {
    process.env.HOSTING_TARGET = "cf";
    expect(shouldSkipCategoryAssignmentShardFanOut({ repoIds: [1, 33, 32] })).toBe(true);
    expect(shouldSkipCategoryAssignmentShardFanOut()).toBe(false);
    const { maxInFlight, shardReads, paths, result } = await loadWithProbe({ repoIds: [1, 33, 32] });
    expect(result).toBeNull();
    expect(shardReads).toBe(0);
    expect(maxInFlight).toBe(0);
    expect(paths).toEqual([]);
  });

  test("empty repo-id selection reads the index only", async () => {
    const { shardReads, result } = await loadWithProbe({ repoIds: [] });
    expect(shardReads).toBe(0);
    expect(result).toEqual({
      rules_version: assignments.rules_version,
      generated_at: assignments.generated_at,
      repositories: {},
    });
  });

  test("omits the assembled map when a required shard is missing", async () => {
    const result = await loadCategoryAssignments(missingShardReader(1), {}, "omit");
    expect(result).toBeNull();
  });

  test("throws when an authoritative read is missing a shard", async () => {
    await expect(loadCategoryAssignments(missingShardReader(30), {}, "throw")).rejects.toThrow(
      /missing shard bucket\(s\) 30/,
    );
  });

  test("memoizes a full assemble so a second call does not re-fan-out", async () => {
    const first = await loadWithProbe();
    const second = await loadWithProbe({ resetMemo: false });
    expect(first.shardReads).toBe(CATEGORY_ASSIGNMENT_SHARD_COUNT);
    expect(second.shardReads).toBe(0);
    expect(second.result).toEqual(first.result);
  });
});

async function loadWithProbe(args?: {
  document?: CategoryAssignmentsData | CategoryAssignmentsIndexData;
  repoIds?: readonly number[];
  resetMemo?: boolean;
}): Promise<{
  maxInFlight: number;
  shardReads: number;
  paths: string[];
  result: CategoryAssignmentsData | null;
}> {
  if (args?.resetMemo !== false) resetCategoryAssignmentsMemoForTests();
  let inFlight = 0;
  let maxInFlight = 0;
  let shardReads = 0;
  const paths: string[] = [];
  const document = args?.document ?? index;

  const read = async <T>(rel: string, schema: ZodType<T>, _opts?: ViewOpts): Promise<T | null> => {
    paths.push(rel);
    if (rel === "categories/assignments.json") {
      return schema.parse(document);
    }
    const shard = shardByPath.get(rel);
    if (!shard) return null;
    shardReads += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 8));
    inFlight -= 1;
    return schema.parse(shard);
  };

  const result = await loadCategoryAssignments(read, {}, "omit", args?.repoIds ? { repoIds: args.repoIds } : undefined);
  return { maxInFlight, shardReads, paths, result };
}

function missingShardReader(missingBucket: number) {
  return async <T>(rel: string, schema: ZodType<T>, _opts?: ViewOpts): Promise<T | null> => {
    if (rel === "categories/assignments.json") return schema.parse(index);
    if (rel === categoryAssignmentsShardPath(missingBucket)) return null;
    const shard = shardByPath.get(rel);
    return shard ? schema.parse(shard) : null;
  };
}
