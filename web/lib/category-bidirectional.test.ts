import { describe, expect, test } from "bun:test";
import { categoryDetailPagePath } from "@/app/categories/category-page-data";
import type { CategoryAssignments, CategoryRankList, CategoryRegistry, ReposLookup } from "@/lib/contracts";
import { joinRepoRank } from "@/lib/data/rank";
import { CATEGORY_DETAIL_PAGE_SIZE } from "@/lib/pagination";
import { categoryHref, repoCategoryLinks } from "@/lib/repo-page";

/**
 * #370 / REQ-CATEGORY-001: a public category assignment is bidirectional.
 * Repo hub chips (repoCategoryLinks) and category detail ranks (joinRepoRank
 * on getCategoryAllTimePage shards) must agree for the same fixture.
 */

const GENERATED_AT = "2026-06-04T12:00:00.000Z";
const REPO_ID = 7;
const REPO_FULL_NAME = "golang/go";
const CATEGORY_ID = "language/go";
const DIMENSION = "language";
const SLUG = "go";
const ECOSYSTEM_ID = "ecosystem/kubernetes";

describe("bidirectional public category assignment (#370)", () => {
  test("public assignment appears as a repo chip and on category page-1 rank (REQ-CATEGORY-001)", () => {
    const registry = registryFixture();
    const assignments = assignmentsFixture({ language: [CATEGORY_ID], ecosystem: [ECOSYSTEM_ID] });
    const languages = [{ name: "Go" }];
    const lookup = lookupFixture();
    const rankPage1 = categoryRankFixture(1, [
      { rank: 1, id: REPO_ID, value: 120_000 },
      { rank: 2, id: 8, value: 40_000 },
    ]);

    // Repo → category: same helper RepoPageView uses via buildRepoHub.
    const chips = repoCategoryLinks(REPO_ID, assignments, registry, languages);
    expect(chips).toContainEqual({
      id: CATEGORY_ID,
      label: "Go",
      href: categoryHref(DIMENSION, SLUG),
    });
    expect(chips).toContainEqual({
      id: ECOSYSTEM_ID,
      label: "Kubernetes",
      href: categoryHref("ecosystem", "kubernetes"),
    });
    expect(chips.every((chip) => chip.href.startsWith("/categories/"))).toBe(true);

    // Category → repo: same join CategoryDetailPageView uses for ranking rows.
    const pageRows = joinRepoRank(rankPage1.items, lookup);
    expect(pageRows.some((row) => row.id === REPO_ID)).toBe(true);
    expect(pageRows.find((row) => row.id === REPO_ID)?.full_name).toBe(REPO_FULL_NAME);

    // Fixture integrity: every ranked id is assigned to this public category.
    for (const item of rankPage1.items) {
      expect(typeof item.id).toBe("number");
      expect(assignments.repositories[String(item.id)]?.[DIMENSION]).toContain(CATEGORY_ID);
    }

    // Entry path for the category detail page that hosts the repo.
    expect(categoryDetailPagePath(DIMENSION, SLUG, 1)).toBe(`/categories/${DIMENSION}/${SLUG}`);
  });

  test("when the assigned repo is past page 1, a category pagination path reaches it", () => {
    const registry = registryFixture();
    const assignments = assignmentsFixture({ language: [CATEGORY_ID], ecosystem: [] });
    const languages = [{ name: "Go" }];

    // Page-1 fillers, then the assigned fixture repo on page 2 (same size as product pagination).
    const page1Ids = Array.from({ length: CATEGORY_DETAIL_PAGE_SIZE }, (_, i) => 1000 + i);
    for (const id of page1Ids) {
      assignments.repositories[String(id)] = emptyAssignment({ language: [CATEGORY_ID] });
    }

    const rankPages = [
      categoryRankFixture(
        1,
        page1Ids.map((id, i) => ({ rank: i + 1, id, value: 200_000 - i })),
      ),
      categoryRankFixture(2, [{ rank: CATEGORY_DETAIL_PAGE_SIZE + 1, id: REPO_ID, value: 50_000 }]),
    ];

    const chips = repoCategoryLinks(REPO_ID, assignments, registry, languages);
    expect(chips.some((chip) => chip.id === CATEGORY_ID)).toBe(true);
    // Chip always targets the category entry (page 1); deeper pages are pagination.
    expect(chips.find((chip) => chip.id === CATEGORY_ID)?.href).toBe(categoryHref(DIMENSION, SLUG));

    const pageForRepo = findCategoryPageForRepo(rankPages, REPO_ID);
    expect(pageForRepo).toBe(2);
    expect(categoryDetailPagePath(DIMENSION, SLUG, pageForRepo!)).toBe(
      `/categories/${DIMENSION}/${SLUG}/page/2`,
    );

    // Page that hosts the repo includes it after the same join the detail view uses.
    const page2Rows = joinRepoRank(rankPages[1].items, lookupFixture());
    expect(page2Rows.map((row) => row.id)).toContain(REPO_ID);

    // Page 1 does not include the assigned fixture repo.
    const page1Rows = joinRepoRank(rankPages[0].items, fillerLookup(page1Ids));
    expect(page1Rows.map((row) => row.id)).not.toContain(REPO_ID);
  });
});

function findCategoryPageForRepo(
  rankPages: ReadonlyArray<CategoryRankList & { page: number }>,
  repoId: number,
): number | null {
  for (const page of rankPages) {
    if (page.items.some((item) => item.id === repoId)) return page.page;
  }
  return null;
}

function registryFixture(): CategoryRegistry {
  return {
    rules_version: "bidirectional-fixture",
    generated_at: GENERATED_AT,
    dimensions: [
      {
        id: "language",
        label: "Language",
        categories: [
          {
            id: CATEGORY_ID,
            dimension: "language",
            slug: SLUG,
            label: "Go",
            count: 2,
            public: true,
            sitemap: true,
            minimum_repo_count: 1,
          },
        ],
      },
      {
        id: "ecosystem",
        label: "Ecosystem",
        categories: [
          {
            id: ECOSYSTEM_ID,
            dimension: "ecosystem",
            slug: "kubernetes",
            label: "Kubernetes",
            count: 1,
            public: true,
            sitemap: true,
            minimum_repo_count: 1,
          },
        ],
      },
    ],
  };
}

function emptyAssignment(overrides: Partial<CategoryAssignments["repositories"][string]> = {}) {
  return {
    language: [] as string[],
    language_family: [] as string[],
    domain: [] as string[],
    project_type: [] as string[],
    ecosystem: [] as string[],
    owner_kind: ["owner_kind/organization"],
    maturity: [] as string[],
    ...overrides,
  };
}

function assignmentsFixture(parts: { language: string[]; ecosystem: string[] }): CategoryAssignments {
  return {
    rules_version: "bidirectional-fixture",
    generated_at: GENERATED_AT,
    repositories: {
      [String(REPO_ID)]: emptyAssignment({
        language: parts.language,
        ecosystem: parts.ecosystem,
      }),
      "8": emptyAssignment({ language: [CATEGORY_ID] }),
    },
  };
}

function lookupFixture(): ReposLookup {
  return {
    [String(REPO_ID)]: {
      owner: "golang",
      name: "go",
      full_name: REPO_FULL_NAME,
      owner_type: "Organization",
      language: "Go",
      current_stars: 120_000,
    },
    "8": {
      owner: "other",
      name: "tools",
      full_name: "other/tools",
      owner_type: "Organization",
      language: "Go",
      current_stars: 40_000,
    },
  };
}

function fillerLookup(ids: number[]): ReposLookup {
  return Object.fromEntries(
    ids.map((id) => [
      String(id),
      {
        owner: `owner-${id}`,
        name: `repo-${id}`,
        full_name: `owner-${id}/repo-${id}`,
        owner_type: "Organization" as const,
        language: "Go",
        current_stars: 10_000,
      },
    ]),
  );
}

function categoryRankFixture(
  page: number,
  items: Array<{ rank: number; id: number; value: number }>,
): CategoryRankList & { page: number } {
  return {
    page,
    meta: {
      window: "all",
      period: "all",
      dim: "repo",
      metric: "stock",
      generated_at: GENERATED_AT,
      category: { id: CATEGORY_ID, dimension: DIMENSION, slug: SLUG },
    },
    items: items.map((item) => ({ ...item, prev_rank: null })),
  };
}
