import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, CategoryRegistry, ReposLookup } from "@/lib/contracts";
import {
  REPO_HUB_LINK_TYPES,
  REPO_HUB_RELATED_LIMIT,
  buildRepoHub,
  compareHref,
  ownerHref,
  rankingMonthHref,
  rankingMonthHrefIfRoutable,
  relatedRepositories,
  repoCategoryLinks,
  repoHubPresentLinkTypes,
  repoLanguageEntries,
  repoRankingAppearances,
} from "./repo-page";

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

  test("excludes inactive historical peers and caps the list", () => {
    const lookup: ReposLookup = {
      "1": repo("org/current", "org", "current", "TypeScript", 100),
      "2": { ...repo("org/old", "org", "old", "TypeScript", 90), active: false },
      "3": repo("org/a", "org", "a", "Go", 10),
      "4": repo("org/b", "org", "b", "Go", 9),
      "5": repo("org/c", "org", "c", "Go", 8),
      "6": repo("org/d", "org", "d", "Go", 7),
      "7": repo("org/e", "org", "e", "Go", 6),
      "8": repo("org/f", "org", "f", "Go", 5),
      "9": repo("other/peer", "other", "peer", "TypeScript", 400),
    };

    const related = relatedRepositories({ full_name: "org/current", owner: "org", language: "TypeScript" }, lookup);
    expect(related.map((entry) => entry.full_name)).toEqual(["org/a", "org/b", "org/c", "org/d", "org/e", "org/f"]);
    expect(related).toHaveLength(REPO_HUB_RELATED_LIMIT);
    expect(related.map((entry) => entry.full_name)).not.toContain("org/old");
  });
});

describe("repoRankingAppearances", () => {
  test("prefers rank_history months and links a non-all-time period", () => {
    expect(
      repoRankingAppearances({
        rank_history: { month: [["2025-01", 4], ["2026-06", 1]] },
        monthly_table: [{ month: "2026-06", adds: 1200, rank: 9 }],
      }),
    ).toEqual([
      { period: "2026-06", rank: 1, adds: 1200 },
      { period: "2025-01", rank: 4, adds: undefined },
    ]);
    expect(rankingMonthHref("2026-06")).toBe("/rankings/2026/6");
  });

  test("falls back to monthly_table ranks when history is empty", () => {
    expect(
      repoRankingAppearances({
        rank_history: { month: [] },
        monthly_table: [
          { month: "2026-05", adds: 10, rank: null },
          { month: "2026-06", adds: 20, rank: 3 },
        ],
      }),
    ).toEqual([{ period: "2026-06", rank: 3, adds: 20 }]);
  });
});

describe("rankingMonthHrefIfRoutable", () => {
  const now = new Date("2026-08-15T12:00:00.000Z");

  test("maps a frozen milestone date to that UTC month ranking path", () => {
    expect(rankingMonthHrefIfRoutable("2020-03-15", now)).toBe("/rankings/2020/3");
    expect(rankingMonthHrefIfRoutable("2015-01-01", now)).toBe("/rankings/2015/1");
    expect(rankingMonthHrefIfRoutable("2026-08-02", now)).toBe("/rankings/2026/8");
  });

  test("returns null for missing, malformed, or out-of-range months", () => {
    expect(rankingMonthHrefIfRoutable("", now)).toBeNull();
    expect(rankingMonthHrefIfRoutable("not-a-date", now)).toBeNull();
    expect(rankingMonthHrefIfRoutable("2026-13-01", now)).toBeNull();
    expect(rankingMonthHrefIfRoutable("2014-12-31", now)).toBeNull();
    expect(rankingMonthHrefIfRoutable("2026-09-01", now)).toBeNull();
  });
});

describe("buildRepoHub #356 contract", () => {
  test("a complete fixture exposes every hub link type", () => {
    const hub = buildRepoHub({
      repoId: 42,
      owner: "org",
      fullName: "org/current",
      language: "TypeScript",
      languages: [{ name: "TypeScript" }],
      rankHistory: { month: [["2026-06", 1]] },
      monthlyTable: [{ month: "2026-06", adds: 50, rank: 1 }],
      assignments: assignmentsFixture(),
      registry: registryFixture(),
      lookup: {
        "42": repo("org/current", "org", "current", "TypeScript", 100),
        "43": repo("org/sibling", "org", "sibling", "Go", 80),
      },
    });

    expect(hub.owner).toEqual({ login: "org", href: "/o/org" });
    expect(hub.compare.href).toBe("/compare?repos=org%2Fcurrent");
    expect(hub.categories.some((category) => category.href.startsWith("/categories/"))).toBe(true);
    expect(hub.rankingAppearances.some((appearance) => rankingMonthHref(appearance.period) !== "/rankings")).toBe(true);
    expect(hub.related.length).toBeGreaterThan(0);
    expect(hub.related.length).toBeLessThanOrEqual(REPO_HUB_RELATED_LIMIT);
    expect(repoHubPresentLinkTypes(hub).sort()).toEqual([...REPO_HUB_LINK_TYPES].sort());
    expect(ownerHref("org")).toBe("/o/org");
    expect(compareHref("org/current")).toBe(hub.compare.href);
  });

  test("owner and compare remain when optional hub types have no data", () => {
    const hub = buildRepoHub({
      repoId: 1,
      owner: "solo",
      fullName: "solo/only",
      language: null,
      languages: [],
      rankHistory: { month: [] },
      monthlyTable: [],
      assignments: null,
      registry: null,
      lookup: { "1": repo("solo/only", "solo", "only", null, 10) },
    });

    expect(repoHubPresentLinkTypes(hub)).toEqual(["owner", "compare"]);
    expect(hub.owner.href).toBe("/o/solo");
    expect(hub.compare.href).toBe("/compare?repos=solo%2Fonly");
    expect(hub.categories).toEqual([]);
    expect(hub.rankingAppearances).toEqual([]);
    expect(hub.related).toEqual([]);
  });
});

function repo(full_name: string, owner: string, name: string, language: string | null, current_stars: number) {
  return { owner, name, full_name, owner_type: "Organization" as const, language, current_stars };
}

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
}

function assignmentsFixture(): CategoryAssignments {
  return {
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
}
