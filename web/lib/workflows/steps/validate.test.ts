import { describe, expect, test } from "bun:test";
import { HIGH_D_FACTOR_WARN_THRESHOLD, inspectAnchoringFactors } from "./validate";
import { validateAliases, validateCategories, validateMeta, validateSearchIndex } from "./validate-invariants";

describe("inspectAnchoringFactors", () => {
  test("reports high anchoring factors without producing publish failures", () => {
    expect(
      inspectAnchoringFactors([
        {
          "1": { d: 0.8 },
          "2": { d: HIGH_D_FACTOR_WARN_THRESHOLD },
          "3": { d: HIGH_D_FACTOR_WARN_THRESHOLD + 0.01 },
          "4": { d: 12.9123 },
          "5": {},
        },
      ]),
    ).toEqual({
      d_factor_warn_threshold: HIGH_D_FACTOR_WARN_THRESHOLD,
      d_factor_repos_checked: 5,
      d_factor_repos_with_d: 4,
      d_factor_high_count: 2,
      d_factor_max: 12.912,
      d_factor_warning: true,
    });
  });
});

describe("validateMeta", () => {
  test("reports folded_through regressions with the published failure wording", () => {
    expect(
      validateMeta(
        {
          seam_date: "2026-01-01",
          schema_ver: 1,
          folded_through: { month: "2026-03", week: "2026-W10" },
        },
        {
          seam_date: "2026-01-01",
          schema_ver: 1,
          folded_through: { month: "2026-04", week: "2026-W11" },
        },
      ),
    ).toEqual({
      invariants: {
        seam_date_present: true,
        folded_through_monotonic: false,
      },
      failures: ["meta.folded_through regressed from 2026-04/2026-W11 to 2026-03/2026-W10"],
    });
  });
});

describe("validateAliases", () => {
  test("counts dangling, colliding, and regressed aliases", () => {
    expect(
      validateAliases(
        { "old/name": 9, "owner/live": 1 },
        {
          "1": repoLookup("owner/live", 100),
          "2": repoLookup("owner/other", 80),
        },
        { "old/name": 9, "owner/live": 1, "older/name": 2 },
      ),
    ).toEqual({
      invariants: {
        alias_count: 2,
        alias_dangling: 1,
        alias_colliding: 1,
        alias_prev_count: 3,
        alias_non_regression: false,
      },
      failures: [
        "lookup/aliases: 1 alias(es) point to an untracked id",
        "lookup/aliases: 1 alias(es) shadow a live repo",
        "lookup/aliases: count regressed from 3 to 2",
      ],
    });
  });
});

describe("validateSearchIndex", () => {
  test("keeps the existing minimum repo failure shape", () => {
    expect(
      validateSearchIndex(
        {
          generated_at: "2026-01-01T00:00:00.000Z",
          count: 1,
          repos: [{ id: 1, full_name: "owner/repo", owner: "owner", language: "TypeScript", current_stars: 10, description: null }],
        },
        2,
      ),
    ).toEqual({
      invariants: { search_repos: 1 },
      failures: ["search/index: only 1 repos"],
    });
  });
});

describe("validateCategories", () => {
  test("reports registry, assignment, and lookup invariants independently", () => {
    const report = validateCategories({
      categoryRegistry: {
        rules_version: "test",
        generated_at: "2026-01-01T00:00:00.000Z",
        dimensions: [
          {
            id: "language",
            label: "Language",
            categories: [
              { id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 1, public: true, sitemap: true, minimum_repo_count: 1 },
            ],
          },
        ],
      },
      categoryAssignments: {
        rules_version: "test",
        generated_at: "2026-01-01T00:00:00.000Z",
        repositories: {
          "1": {
            language: ["language/typescript"],
            language_family: [],
            domain: [],
            project_type: [],
            ecosystem: [],
            owner_kind: [],
            maturity: [],
          },
        },
      },
      categoriesLookup: { rules_version: "test", generated_at: "2026-01-01T00:00:00.000Z", dimensions: [] },
      minLookup: 2,
    });

    expect(report.invariants).toMatchObject({
      category_registry_categories: 1,
      category_public_categories: 1,
      category_assignments_repos: 1,
      category_has_language: true,
      category_has_language_family: false,
      category_single_owner_kind: false,
      category_unknown_refs: 0,
      categories_lookup_categories: 0,
    });
    expect(report.failures).toEqual([
      "categories/assignments: only 1 repos",
      "categories/assignments: language_family must have at least one category per repo",
      "categories/assignments: owner_kind must have exactly one category per repo",
      "lookup/categories: empty",
    ]);
    expect(report.publicCategories.map((category) => category.id)).toEqual(["language/typescript"]);
  });
});

function repoLookup(full_name: string, current_stars: number) {
  const [owner, name] = full_name.split("/");
  return { owner, name, full_name, owner_type: "Organization" as const, language: "TypeScript", current_stars };
}
