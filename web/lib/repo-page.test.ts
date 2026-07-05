import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, CategoryRegistry, ReposLookup } from "@/lib/contracts";
import { relatedRepositories, repoCategoryLinks, repoLanguageEntries } from "./repo-page";

describe("repoLanguageEntries", () => {
  test("keeps the primary language first and filters low-share breakdown languages", () => {
    expect(
      repoLanguageEntries({
        language: "JavaScript",
        languages: [
          { name: "TypeScript", size: 25, color: "#3178c6" },
          { name: "JavaScript", size: 70, color: "#f1e05a" },
          { name: "Shell", size: 5, color: "#89e051" },
        ],
      }).map((language) => language.name),
    ).toEqual(["JavaScript", "TypeScript"]);
  });
});

describe("repoCategoryLinks", () => {
  test("combines language links with public assigned categories without duplicates", () => {
    const registry: CategoryRegistry = {
      rules_version: "test",
      generated_at: "2026-01-01T00:00:00.000Z",
      dimensions: [
        {
          id: "language",
          label: "Language",
          categories: [
            { id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 3, public: true, sitemap: true, minimum_repo_count: 1 },
            { id: "language/rust", dimension: "language", slug: "rust", label: "Rust", count: 1, public: false, sitemap: false, minimum_repo_count: 1 },
          ],
        },
        {
          id: "ecosystem",
          label: "Ecosystem",
          categories: [
            { id: "ecosystem/react", dimension: "ecosystem", slug: "react", label: "React", count: 2, public: true, sitemap: true, minimum_repo_count: 1 },
          ],
        },
      ],
    };
    const assignments: CategoryAssignments = {
      rules_version: "test",
      generated_at: "2026-01-01T00:00:00.000Z",
      repositories: {
        "42": {
          language: ["language/typescript", "language/rust"],
          language_family: [],
          domain: [],
          project_type: [],
          ecosystem: ["ecosystem/react"],
          owner_kind: ["owner_kind/organization"],
          maturity: [],
        },
      },
    };

    expect(repoCategoryLinks(42, assignments, registry, [{ name: "TypeScript" }])).toEqual([
      { id: "language/typescript", label: "TypeScript", href: "/categories/language/typescript" },
      { id: "ecosystem/react", label: "React", href: "/categories/ecosystem/react" },
    ]);
  });
});

describe("relatedRepositories", () => {
  test("prioritizes same-owner repositories, then same-language repositories by stars", () => {
    const lookup: ReposLookup = {
      "1": repo("org/current", "org", "current", "TypeScript", 100),
      "2": repo("org/sibling", "org", "sibling", "Go", 80),
      "3": repo("other/top-ts", "other", "top-ts", "TypeScript", 200),
      "4": repo("other/low-ts", "other", "low-ts", "TypeScript", 50),
    };

    expect(relatedRepositories({ full_name: "org/current", owner: "org", language: "TypeScript" }, lookup, 3).map((entry) => entry.full_name)).toEqual([
      "org/sibling",
      "other/top-ts",
      "other/low-ts",
    ]);
  });
});

function repo(full_name: string, owner: string, name: string, language: string | null, current_stars: number) {
  return { owner, name, full_name, owner_type: "Organization" as const, language, current_stars };
}
