import { describe, expect, test } from "bun:test";
import {
  CATEGORY_ASSIGNMENT_SHARD_COUNT,
  CategoryAssignments,
  CategoryAssignmentsIndex,
} from "@/lib/contracts";
import {
  assembleCategoryAssignments,
  categoryAssignmentsPublicationArtifacts,
  categoryAssignmentsShardPath,
  isCategoryAssignmentsIndex,
  splitCategoryAssignments,
} from "./category-assignment-shards";

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

describe("category assignment shards", () => {
  test("round-trips through index + 32 shards and keeps bucket membership", () => {
    const { index, shards } = splitCategoryAssignments(assignments);
    expect(index.shard_count).toBe(CATEGORY_ASSIGNMENT_SHARD_COUNT);
    expect(shards).toHaveLength(CATEGORY_ASSIGNMENT_SHARD_COUNT);
    expect(shards[1]?.data.repositories["1"]?.language).toEqual(["language/python"]);
    expect(shards[1]?.data.repositories["33"]?.language).toEqual(["language/python"]);
    expect(shards[0]?.data.repositories["32"]?.language).toEqual(["language/rust"]);
    expect(assembleCategoryAssignments(index, shards.map((shard) => shard.data))).toEqual(assignments);
  });

  test("publication artifacts write a small index at categories/assignments.json", () => {
    const artifacts = categoryAssignmentsPublicationArtifacts(assignments);
    expect(artifacts[0]?.path).toBe("categories/assignments.json");
    expect(isCategoryAssignmentsIndex(artifacts[0]?.data)).toBe(true);
    expect(CategoryAssignmentsIndex.parse(artifacts[0]?.data).shard_count).toBe(32);
    expect(artifacts.some((item) => item.path === categoryAssignmentsShardPath(0))).toBe(true);
    expect("repositories" in (artifacts[0]?.data as object)).toBe(false);
  });

  test("rejects a missing shard instead of silently dropping repos", () => {
    const { index, shards } = splitCategoryAssignments(assignments);
    expect(() => assembleCategoryAssignments(index, shards.slice(1).map((shard) => shard.data))).toThrow(
      /expected 32 shards, received 31|missing shard/,
    );
  });

  test("does not treat a v1 monolith as a v2 index", () => {
    expect(isCategoryAssignmentsIndex(assignments)).toBe(false);
  });
});
