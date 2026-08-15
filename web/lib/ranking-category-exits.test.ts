import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, CategoryRegistry } from "@/lib/contracts";
import { RANKING_CATEGORY_EXIT_LIMIT, rankingCategoryExits } from "./ranking-category-exits";

describe("rankingCategoryExits", () => {
  test("maps leading-row languages and public assignments to real category URLs", () => {
    const links = rankingCategoryExits(
      [
        { id: 1, language: "TypeScript" },
        { id: 2, language: "TypeScript" },
        { id: 3, language: "Go" },
      ],
      registryFixture(),
      assignmentsFixture(),
    );

    expect(links.map((link) => link.id)).toEqual(["language/typescript", "ecosystem/react", "language/go"]);
    expect(links[0]).toEqual({ id: "language/typescript", label: "TypeScript", href: "/categories/language/typescript" });
    expect(links.some((link) => link.href.startsWith("/categories/"))).toBe(true);
  });

  test("drops private, unknown, and out-of-registry languages", () => {
    const links = rankingCategoryExits(
      [
        { id: 8, language: "Rust" },
        { id: 9, language: "Brainfuck" },
      ],
      registryFixture(),
      assignmentsFixture(),
    );
    expect(links.map((link) => link.id)).toEqual([]);
  });

  test("returns nothing without a registry and stays bounded", () => {
    expect(rankingCategoryExits([{ language: "TypeScript" }], null)).toEqual([]);
    const many = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, language: `Lang${index}` }));
    expect(rankingCategoryExits(many, registryFixture(), assignmentsFixture()).length).toBeLessThanOrEqual(RANKING_CATEGORY_EXIT_LIMIT);
  });
});

function registryFixture(): CategoryRegistry {
  return {
    rules_version: "test",
    generated_at: "2026-01-01T00:00:00.000Z",
    dimensions: [
      {
        id: "language",
        label: "Language",
        categories: [
          { id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 3, public: true, sitemap: true, minimum_repo_count: 1 },
          { id: "language/go", dimension: "language", slug: "go", label: "Go", count: 2, public: true, sitemap: true, minimum_repo_count: 1 },
          { id: "language/rust", dimension: "language", slug: "rust", label: "Rust", count: 1, public: false, sitemap: false, minimum_repo_count: 1 },
        ],
      },
      {
        id: "ecosystem",
        label: "Ecosystem",
        categories: [{ id: "ecosystem/react", dimension: "ecosystem", slug: "react", label: "React", count: 2, public: true, sitemap: true, minimum_repo_count: 1 }],
      },
    ],
  };
}

function assignmentsFixture(): CategoryAssignments {
  const empty = {
    language: [] as string[],
    language_family: [] as string[],
    domain: [] as string[],
    project_type: [] as string[],
    ecosystem: [] as string[],
    owner_kind: ["owner_kind/organization"],
    maturity: [] as string[],
  };
  return {
    rules_version: "test",
    generated_at: "2026-01-01T00:00:00.000Z",
    repositories: {
      "1": { ...empty, language: ["language/typescript"], ecosystem: ["ecosystem/react"] },
      "2": { ...empty, language: ["language/typescript"] },
    },
  };
}
