import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, CategoryRegistry, ReposLookup } from "@/lib/contracts";
import { relatedRepositories, repoCategoryLinks, repoLanguageEntries } from "./repo-page";

const TS = "2026-01-01T00:00:00.000Z";

describe("repo page projection helpers", () => {
  test("orders the primary language first and filters non-category languages", () => {
    const languages = repoLanguageEntries({
      language: "TypeScript",
      languages: [
        { name: "JavaScript", size: 200, color: "#f1e05a" },
        { name: "TypeScript", size: 800, color: "#3178c6" },
        { name: "Rust", size: 1, color: "#dea584" },
      ],
    });

    expect(languages.map((language) => language.name)).toEqual(["TypeScript", "JavaScript"]);
  });

  test("builds category links from language fallbacks plus public assignments", () => {
    const registry = {
      rules_version: "1",
      generated_at: TS,
      dimensions: [
        {
          id: "domain",
          label: "Domain",
          categories: [
            {
              id: "domain/ai-ml",
              dimension: "domain",
              slug: "ai-ml",
              label: "AI / ML",
              count: 1,
              public: true,
              sitemap: true,
              minimum_repo_count: 1,
            },
          ],
        },
      ],
    } as CategoryRegistry;
    const assignments = {
      rules_version: "1",
      generated_at: TS,
      repositories: {
        "1": {
          language: ["language/typescript"],
          language_family: [],
          domain: ["domain/ai-ml"],
          project_type: [],
          ecosystem: [],
          owner_kind: [],
          maturity: [],
        },
      },
    } as CategoryAssignments;

    expect(repoCategoryLinks(1, assignments, registry, [{ name: "TypeScript" }])).toEqual([
      { id: "language/typescript", label: "TypeScript", href: "/categories/language/typescript" },
      { id: "domain/ai-ml", label: "AI / ML", href: "/categories/domain/ai-ml" },
    ]);
  });

  test("prefers same-owner related repos before same-language repos", () => {
    const lookup = {
      "1": { owner: "acme", name: "main", full_name: "acme/main", owner_type: "Organization", language: "TypeScript", current_stars: 100 },
      "2": { owner: "acme", name: "other", full_name: "acme/other", owner_type: "Organization", language: "Rust", current_stars: 500 },
      "3": { owner: "other", name: "ts", full_name: "other/ts", owner_type: "User", language: "TypeScript", current_stars: 900 },
    } as ReposLookup;

    expect(relatedRepositories({ full_name: "acme/main", owner: "acme", language: "TypeScript" }, lookup).map((repo) => repo.full_name)).toEqual([
      "acme/other",
      "other/ts",
    ]);
  });
});
