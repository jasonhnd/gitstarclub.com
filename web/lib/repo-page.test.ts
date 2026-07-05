import { describe, expect, test } from "bun:test";
import { languageHref, relatedRepositories, repoCategoryLinks, repoLanguageEntries } from "./repo-page";

describe("repo page helpers", () => {
  test("dedupes language entries and keeps the primary language first", () => {
    const languages = repoLanguageEntries({
      language: "TypeScript",
      languages: [
        { name: "JavaScript", size: 10 },
        { name: "TypeScript", size: 20 },
        { name: "typescript", size: 5 },
      ],
    });

    expect(languages.map((language) => language.name)).toEqual(["TypeScript", "JavaScript"]);
    expect(languageHref("TypeScript")).toBe("/categories/language/typescript");
  });

  test("builds category links from language and public assignments", () => {
    const links = repoCategoryLinks(
      1,
      {
        rules_version: "test",
        generated_at: "2026-07-05T00:00:00Z",
        repositories: {
          "1": {
            language: ["language/typescript"],
            language_family: ["language_family/javascript"],
            domain: [],
            project_type: [],
            ecosystem: [],
            owner_kind: ["owner_kind/org"],
            maturity: [],
          },
        },
      },
      {
        rules_version: "test",
        generated_at: "2026-07-05T00:00:00Z",
        dimensions: [
          {
            id: "owner_kind",
            label: "Owner Kind",
            categories: [
              {
                id: "owner_kind/org",
                dimension: "owner_kind",
                slug: "org",
                label: "Organization",
                count: 1,
                public: true,
                sitemap: true,
                minimum_repo_count: 1,
              },
            ],
          },
        ],
      },
      [{ name: "TypeScript" }],
    );

    expect(links.map((link) => link.href)).toEqual(["/categories/language/typescript", "/categories/owner_kind/org"]);
  });

  test("prefers same-owner related repos before same-language repos", () => {
    const related = relatedRepositories(
      { full_name: "owner/main", owner: "owner", language: "TypeScript" },
      {
        "1": { id: 1, full_name: "owner/main", owner: "owner", name: "main", language: "TypeScript", current_stars: 100 },
        "2": { id: 2, full_name: "owner/side", owner: "owner", name: "side", language: "Go", current_stars: 50 },
        "3": { id: 3, full_name: "other/ts", owner: "other", name: "ts", language: "TypeScript", current_stars: 200 },
      },
    );

    expect(related.map((repo) => repo.full_name)).toEqual(["owner/side", "other/ts"]);
  });
});
