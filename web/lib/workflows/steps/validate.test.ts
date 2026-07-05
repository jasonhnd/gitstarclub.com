import { describe, expect, test } from "bun:test";
import type {
  AliasMap,
  CategoriesLookup,
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  Meta,
  RankItem,
  RankList,
  RepoEntity,
  ReposLookup,
  SearchIndex,
} from "@/lib/contracts";
import {
  HIGH_D_FACTOR_WARN_THRESHOLD,
  inspectAnchoringFactors,
  validateAliasNonRegression,
  validateAliases,
  validateAllTimeRanks,
  validateCategories,
  validateCategorySampleRank,
  validateMeta,
  validateRepoEntitySample,
  validateSearchIndex,
} from "./validate";

const TS = "2026-01-01T00:00:00.000Z";

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

describe("workflow validation invariants", () => {
  test("validateMeta reports folded-through regressions without changing the validation shape", () => {
    const failures: string[] = [];
    const invariants = validateMeta(
      meta({ month: "2026-05", week: "2026-W20" }),
      meta({ month: "2026-06", week: "2026-W21" }),
      failures,
    );

    expect(invariants).toEqual({
      seam_date_present: true,
      folded_through_monotonic: false,
    });
    expect(failures).toEqual(["meta.folded_through regressed from 2026-06/2026-W21 to 2026-05/2026-W20"]);
  });

  test("validateAllTimeRanks keeps repo-rank invariant keys and failures focused", () => {
    const failures: string[] = [];
    const invariants = validateAllTimeRanks(
      {
        allTime: rankList("repo", [{ rank: 2, id: 1, value: 10, prev_rank: null }]),
        allTimeOrg: null,
        lookup: makeLookup(1000),
        orgLookup: null,
      },
      failures,
    );

    expect(invariants.all_time_repo_items).toBe(1);
    expect(invariants.lookup_repos).toBe(1000);
    expect(invariants.all_time_repo_rank_sequential).toBe(false);
    expect(failures).toContain("all-time/repo: rank[0] != 1");
    expect(failures).toContain("all-time/repo: ranks are not sequential from 1");
  });

  test("validateAliases separates current alias safety from non-regression checks", () => {
    const lookup = makeLookup(2);
    lookup["1"] = { ...lookup["1"], full_name: "live/repo", owner: "live", name: "repo" };
    const failures: string[] = [];

    expect(validateAliases({ "old/repo": 1, "missing/repo": 3, "live/repo": 2 } as AliasMap, lookup, failures)).toEqual({
      alias_count: 3,
      alias_dangling: 1,
      alias_colliding: 1,
    });
    expect(validateAliasNonRegression({ "old/repo": 1 } as AliasMap, { "old/repo": 1, "older/repo": 2 } as AliasMap, failures)).toEqual({
      alias_prev_count: 2,
      alias_non_regression: false,
    });
    expect(failures).toEqual([
      "lookup/aliases: 1 alias(es) point to an untracked id",
      "lookup/aliases: 1 alias(es) shadow a live repo",
      "lookup/aliases: count regressed from 2 to 1",
    ]);
  });

  test("validateSearchIndex preserves the published invariant and failure text", () => {
    const failures: string[] = [];

    expect(validateSearchIndex({ generated_at: TS, count: 999, repos: [] } as SearchIndex, failures)).toEqual({ search_repos: 999 });
    expect(failures).toEqual(["search/index: only 999 repos"]);
  });

  test("validateCategories returns public categories and assignment invariants", () => {
    const failures: string[] = [];
    const report = validateCategories(
      {
        categoryRegistry: categoryRegistry(),
        categoryAssignments: categoryAssignments(1000),
        categoriesLookup: {
          rules_version: "1",
          generated_at: TS,
          dimensions: [{ id: "language", label: "Language", categories: [{ id: "language/typescript", slug: "typescript", label: "TypeScript", count: 1000, sitemap: true }] }],
        } as CategoriesLookup,
      },
      failures,
    );

    expect(report.publicCategories.map((category) => category.id)).toEqual([
      "language/typescript",
      "language_family/js-ts",
      "owner_kind/user",
    ]);
    expect(report.invariants).toMatchObject({
      category_registry_categories: 3,
      category_public_categories: 3,
      category_assignments_repos: 1000,
      category_has_language: true,
      category_has_language_family: true,
      category_single_owner_kind: true,
      category_unknown_refs: 0,
      categories_lookup_categories: 1,
    });
    expect(failures).toEqual([]);
  });

  test("validateCategorySampleRank and validateRepoEntitySample keep sample checks isolated", () => {
    const failures: string[] = [];
    const sampleCategory = categoryRegistry().dimensions[0].categories[0];
    const rank = {
      meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: TS, category: { id: sampleCategory.id, dimension: sampleCategory.dimension, slug: sampleCategory.slug } },
      items: [{ rank: 1, id: 1001, value: 10, prev_rank: null }],
    } as CategoryRankList;

    expect(validateCategorySampleRank(sampleCategory, rank, categoryAssignments(1000), failures)).toEqual({
      category_sample_rank_items_assigned: false,
    });
    expect(validateRepoEntitySample(1, { curve: { monthly: [], recent_daily: [] } } as RepoEntity, failures)).toEqual({
      sample_curve_months: 0,
    });
    expect(failures).toEqual([
      "rank/category/language/typescript: contains unassigned repo",
      "entity/repo/1: empty curve",
    ]);
  });
});

function meta(foldedThrough: { month: string; week: string }): Meta {
  return {
    seam_date: "2026-01-01",
    schema_ver: 1,
    generated_at: TS,
    folded_through: foldedThrough,
  } as Meta;
}

function rankList(dim: "repo" | "org", items: RankItem[]): RankList {
  return {
    meta: { window: "all", period: "all", dim, metric: "stock", generated_at: TS },
    items,
  };
}

function makeLookup(count: number): ReposLookup {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return [
        String(id),
        {
          owner: `owner-${id}`,
          name: `repo-${id}`,
          full_name: `owner-${id}/repo-${id}`,
          owner_type: "User",
          language: "TypeScript",
          current_stars: id,
        },
      ];
    }),
  ) as ReposLookup;
}

function categoryRegistry(): CategoryRegistry {
  return {
    rules_version: "1",
    generated_at: TS,
    dimensions: [
      {
        id: "language",
        label: "Language",
        categories: [category("language", "typescript", "TypeScript")],
      },
      {
        id: "language_family",
        label: "Language family",
        categories: [category("language_family", "js-ts", "JavaScript / TypeScript")],
      },
      {
        id: "owner_kind",
        label: "Owner kind",
        categories: [category("owner_kind", "user", "Users")],
      },
    ],
  } as CategoryRegistry;
}

function category(dimension: "language" | "language_family" | "owner_kind", slug: string, label: string) {
  return {
    id: `${dimension}/${slug}`,
    dimension,
    slug,
    label,
    count: 1000,
    public: true,
    sitemap: true,
    minimum_repo_count: 1,
  };
}

function categoryAssignments(count: number): CategoryAssignments {
  return {
    rules_version: "1",
    generated_at: TS,
    repositories: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        String(index + 1),
        {
          language: ["language/typescript"],
          language_family: ["language_family/js-ts"],
          domain: [],
          project_type: [],
          ecosystem: [],
          owner_kind: ["owner_kind/user"],
          maturity: [],
        },
      ]),
    ),
  } as CategoryAssignments;
}
