import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, RankItem, RepoLookupEntry } from "@/lib/contracts";
import { categoryRowsPage } from "./page";

function lookup(count: number): Record<string, RepoLookupEntry> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return [
        String(id),
        {
          id,
          full_name: `owner/repo-${String(id).padStart(3, "0")}`,
          owner: "owner",
          name: `repo-${String(id).padStart(3, "0")}`,
          language: id % 2 ? "TypeScript" : null,
          current_stars: 10_000 - id,
        },
      ];
    }),
  );
}

function assignments(count: number): CategoryAssignments {
  return {
    rules_version: "test",
    generated_at: "2026-07-05T00:00:00Z",
    repositories: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        String(index + 1),
        {
          language: ["language/typescript"],
          language_family: ["language_family/javascript"],
          domain: [],
          project_type: [],
          ecosystem: [],
          owner_kind: ["owner_kind/org"],
          maturity: [],
        },
      ]),
    ),
  };
}

function rankItems(count: number): RankItem[] {
  return Array.from({ length: count }, (_, index) => ({
    rank: index + 1,
    id: index + 1,
    value: 10_000 - index,
    prev_rank: null,
  }));
}

describe("categoryRowsPage", () => {
  test("handles an empty category", () => {
    const page = categoryRowsPage({
      categoryId: "language/typescript",
      dimension: "language",
      rankItems: [],
      lookup: lookup(0),
      assignments: assignments(0),
      page: 1,
      pageSize: 100,
    });

    expect(page.rows).toEqual([]);
    expect(page.totalRows).toBe(0);
    expect(page.totalPages).toBe(1);
  });

  test("returns a small category in rank order", () => {
    const page = categoryRowsPage({
      categoryId: "language/typescript",
      dimension: "language",
      rankItems: rankItems(3),
      lookup: lookup(3),
      assignments: null,
      page: 1,
      pageSize: 100,
    });

    expect(page.source).toBe("rank");
    expect(page.rows.map((row) => row.name)).toEqual(["repo-001", "repo-002", "repo-003"]);
  });

  test("returns only the requested page for a category larger than one page", () => {
    const page = categoryRowsPage({
      categoryId: "language/typescript",
      dimension: "language",
      rankItems: rankItems(150),
      lookup: lookup(150),
      assignments: null,
      page: 2,
      pageSize: 100,
    });

    expect(page.source).toBe("rank");
    expect(page.totalPages).toBe(2);
    expect(page.rows).toHaveLength(50);
    expect(page.rows[0].name).toBe("repo-101");
  });
});
