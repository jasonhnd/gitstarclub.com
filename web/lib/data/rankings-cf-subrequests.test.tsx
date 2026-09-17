import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ZodType } from "zod";
import { CategoryAssignments } from "@/lib/contracts";
import { isCloudflareWorkersHost, runWithCloudflareWorkersHostForTests } from "@/lib/runtime-config";
import {
  loadCategoryAssignments,
  resetCategoryAssignmentsMemoForTests,
  shouldSkipCategoryAssignmentShardFanOut,
} from "./categories";
import { categoryAssignmentsShardPath, splitCategoryAssignments } from "./category-assignment-shards";
import type { ViewOpts } from "./source";

const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const REPO_ID = 1;
const originalHostingTarget = process.env.HOSTING_TARGET;
const originalPublicHostingTarget = process.env.NEXT_PUBLIC_HOSTING_TARGET;
const originalVercelEnv = process.env.VERCEL_ENV;

const assignment = {
  language: ["language/typescript"],
  language_family: [] as string[],
  domain: [] as string[],
  project_type: [] as string[],
  ecosystem: ["ecosystem/react"],
  owner_kind: ["owner_kind/organization"],
  maturity: [] as string[],
};

const assignments = CategoryAssignments.parse({
  rules_version: "test",
  generated_at: GENERATED_AT,
  repositories: { [String(REPO_ID)]: assignment },
});
const { index, shards } = splitCategoryAssignments(assignments);
const shardByPath = new Map(shards.map((shard) => [shard.path, shard.data]));

afterEach(() => {
  resetCategoryAssignmentsMemoForTests();
  if (originalHostingTarget === undefined) delete process.env.HOSTING_TARGET;
  else process.env.HOSTING_TARGET = originalHostingTarget;
  if (originalPublicHostingTarget === undefined) delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
  else process.env.NEXT_PUBLIC_HOSTING_TARGET = originalPublicHostingTarget;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("CF /rankings assignment shard budget", () => {
  test("issues 0 assignment shard reads and keeps language exits", async () => {
    await runWithCloudflareWorkersHostForTests(true, async () => {
      resetCategoryAssignmentsMemoForTests();
      process.env.HOSTING_TARGET = "vercel";
      delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
      delete process.env.VERCEL_ENV;
      expect(isCloudflareWorkersHost()).toBe(true);
      expect(shouldSkipCategoryAssignmentShardFanOut({ repoIds: [REPO_ID] })).toBe(true);
      expect(rankingsSource()).toContain("getCategoryAssignmentsForRepos");
      expect(rankingsSource()).toContain("isCloudflareWorkersHost()");

      const isolated = await loadLeadingRowAssignments();
      expect(isolated.shardReads).toBe(0);
      expect(isolated.paths).toEqual([]);
      expect(isolated.result).toBeNull();

      const pinned = await loadLeadingRowAssignments({ HOSTING_TARGET: "cf" });
      expect(pinned.shardReads).toBe(0);
      expect(pinned.paths).toEqual([]);
      expect(rankingsSource()).toContain("rankingCategoryExits");
    });
  });

  test("Vercel /rankings still reads leading-row assignment shards", async () => {
    await runWithCloudflareWorkersHostForTests(false, async () => {
      resetCategoryAssignmentsMemoForTests();
      // Sibling bun files may leave HOSTING_TARGET=cf; ALS + explicit env must still load shards.
      process.env.HOSTING_TARGET = "cf";
      delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
      delete process.env.VERCEL_ENV;
      expect(isCloudflareWorkersHost()).toBe(false);
      expect(shouldSkipCategoryAssignmentShardFanOut({ repoIds: [REPO_ID] })).toBe(false);
      expect(rankingsSource()).toContain("getCategoryAssignmentsForRepos");
      expect(rankingsSource()).toContain("isCloudflareWorkersHost()");

      const isolated = await loadLeadingRowAssignments({ HOSTING_TARGET: "vercel" });
      expect(isolated.shardReads).toBeGreaterThan(0);
      expect(isolated.paths).toContain("categories/assignments.json");
      expect(isolated.shardPaths).toContain(categoryAssignmentsShardPath(1));
      expect(isolated.result?.repositories[String(REPO_ID)]?.language).toEqual(["language/typescript"]);

      const alsLoader = await loadLeadingRowAssignments();
      expect(alsLoader.shardReads).toBeGreaterThan(0);
      expect(alsLoader.shardPaths).toContain(categoryAssignmentsShardPath(1));
    });
  });
});

function rankingsSource(): string {
  return readFileSync(join(import.meta.dir, "../../app/_localized/rankings.tsx"), "utf8");
}

async function loadLeadingRowAssignments(env?: { HOSTING_TARGET?: string; VERCEL_ENV?: string }): Promise<{
  paths: string[];
  shardPaths: string[];
  shardReads: number;
  result: Awaited<ReturnType<typeof loadCategoryAssignments>>;
}> {
  resetCategoryAssignmentsMemoForTests();
  const paths: string[] = [];
  async function read<T>(rel: string, schema: ZodType<T>, _opts?: ViewOpts): Promise<T | null> {
    paths.push(rel);
    if (rel === "categories/assignments.json") return schema.parse(index);
    const shard = shardByPath.get(rel);
    return shard ? schema.parse(shard) : null;
  }
  const result = await loadCategoryAssignments(read, {}, "omit", { repoIds: [REPO_ID] }, env);
  const shardPaths = paths.filter((path) => path.includes("assignments/shards/"));
  return { paths, shardPaths, shardReads: shardPaths.length, result };
}
