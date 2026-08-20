import { describe, expect, test } from "bun:test";
import type { CategoryAssignments, CategoryRegistry } from "@/lib/contracts";
import { MAX_COMPARE } from "@/lib/compare/constants";
import { ORG_HUB_CATEGORY_LIMIT, buildOrgHub, orgCategoryLinks, orgCompareHref } from "./org-page";

describe("orgCategoryLinks", () => {
  test("derives public categories from member assignments and languages, ranked by frequency", () => {
    const links = orgCategoryLinks([1, 2], ["TypeScript", "TypeScript"], assignmentsFixture(), registryFixture());
    expect(links.map((link) => link.id)).toEqual(["language/typescript", "ecosystem/react"]);
    expect(links[0]?.href).toBe("/categories/language/typescript");
    expect(links.some((link) => link.id === "language/rust")).toBe(false);
  });

  test("drops non-public registry categories and stays bounded", () => {
    const memberIds = Array.from({ length: 12 }, (_, index) => index + 1);
    const languages = memberIds.map((_, index) => `Lang${index}`);
    expect(orgCategoryLinks(memberIds, languages, assignmentsFixture(), registryFixture()).length).toBeLessThanOrEqual(ORG_HUB_CATEGORY_LIMIT);
  });
});

describe("orgCompareHref", () => {
  test("encodes the org's top tracked members for compare", () => {
    expect(orgCompareHref(["org/lead", "org/second"])).toBe("/compare?repos=org%2Flead%2Corg%2Fsecond");
  });

  test("caps at MAX_COMPARE and ignores invalid names", () => {
    const names = ["org/a", "skip", "org/b", "org/c", "org/d", "org/e", "org/f", "org/a"];
    const href = orgCompareHref(names);
    expect(href).toBe(`/compare?repos=${encodeURIComponent("org/a,org/b,org/c,org/d,org/e")}`);
    expect(href?.split("%2C").length).toBe(MAX_COMPARE);
    expect(orgCompareHref(["nolead"])).toBeNull();
  });
});

describe("buildOrgHub", () => {
  test("exposes categories and compare when members are assigned", () => {
    const hub = buildOrgHub({
      memberIds: [1, 2],
      memberFullNames: ["org/lead", "org/second"],
      memberLanguages: ["TypeScript", "Go"],
      assignments: assignmentsFixture(),
      registry: registryFixture(),
      rankHistory: { month: [["2026-06", 4]] },
    });

    expect(hub.categories.length).toBeGreaterThan(0);
    expect(hub.compare?.href).toBe("/compare?repos=org%2Flead%2Corg%2Fsecond");
    expect(hub.rankingAppearances.map((row) => row.period)).toEqual(["2026-06"]);
  });

  test("omits compare and ranking when members and history are empty", () => {
    const hub = buildOrgHub({
      memberIds: [],
      memberFullNames: [],
      memberLanguages: [],
      assignments: null,
      registry: null,
    });
    expect(hub.categories).toEqual([]);
    expect(hub.compare).toBeNull();
    expect(hub.rankingAppearances).toEqual([]);
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
      "1": { ...empty, language: ["language/typescript", "language/rust"], ecosystem: ["ecosystem/react"] },
      "2": { ...empty, language: ["language/typescript"] },
    },
  };
}
