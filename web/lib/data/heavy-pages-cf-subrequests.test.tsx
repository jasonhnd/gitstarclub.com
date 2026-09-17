import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  loadCategoryAssignments,
  resetCategoryAssignmentsMemoForTests,
  shouldSkipCategoryAssignmentShardFanOut,
} from "./categories";

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

describe("CF ranking-detail / repo / org skip full assignment fan-out", () => {
  test("pages skip the full getCategoryAssignments() assemble and prefer page-id shards", () => {
    const detail = source("ranking-detail.tsx");
    const repo = source("repo.tsx");
    const org = source("org.tsx");

    expect(detail).toContain("isCloudflareWorkersHost()");
    expect(detail).toContain("getCategoryAssignmentsForRepos");
    expect(detail).not.toContain("getCategoryAssignments()");
    expect(detail).toContain("loadPageCategoryAssignments");

    expect(repo).toContain("isCloudflareWorkersHost()");
    expect(repo).toContain("getCategoryAssignmentsForRepos([id])");
    expect(repo).not.toContain("getCategoryAssignments()");

    expect(org).toContain("isCloudflareWorkersHost()");
    expect(org).toContain("getCategoryAssignmentsForRepos(org.members)");
    expect(org).not.toContain("getCategoryAssignments()");
  });

  test("CF host short-circuits full and page-id loads with 0 reader I/O", async () => {
    const env = { HOSTING_TARGET: "cf" };
    const reads: string[] = [];
    const read = async (rel: string) => {
      reads.push(rel);
      throw new Error(`unexpected assignment read ${rel}`);
    };

    expect(shouldSkipCategoryAssignmentShardFanOut(undefined, env)).toBe(true);
    expect(shouldSkipCategoryAssignmentShardFanOut({ repoIds: [1] }, env)).toBe(true);
    expect(await loadCategoryAssignments(read as never, {}, "omit", undefined, env)).toBeNull();
    expect(await loadCategoryAssignments(read as never, {}, "omit", { repoIds: [1] }, env)).toBeNull();
    expect(reads).toEqual([]);
  });

  test("Vercel still performs reader I/O for a page-id selection", async () => {
    const env = { HOSTING_TARGET: "vercel" };
    const reads: string[] = [];
    const read = async (rel: string) => {
      reads.push(rel);
      return null;
    };

    expect(shouldSkipCategoryAssignmentShardFanOut(undefined, env)).toBe(false);
    expect(await loadCategoryAssignments(read as never, {}, "omit", { repoIds: [1] }, env)).toBeNull();
    expect(reads).toContain("categories/assignments.json");
    expect(reads.some((path) => path.includes("assignments/shards/"))).toBe(false);
  });
});

function source(name: "ranking-detail.tsx" | "repo.tsx" | "org.tsx"): string {
  return readFileSync(join(import.meta.dir, "../../app/_localized", name), "utf8");
}
