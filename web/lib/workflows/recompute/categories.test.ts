import { describe, expect, test } from "bun:test";
import { buildModel, type RawShards, type RepoMeta } from "./model";
import { computeCategoryViews } from "./categories";

const GEN = "2026-06-05T00:00:00Z";

function repo(id: number, extra: Partial<RepoMeta>): RepoMeta {
  const owner = extra.owner ?? `owner${id}`;
  return {
    id,
    owner,
    owner_type: extra.owner_type ?? "User",
    name: extra.name ?? `repo${id}`,
    full_name: extra.full_name ?? `${owner}/repo${id}`,
    current_stars: extra.current_stars ?? 10_000,
    d: extra.d ?? 1,
    ...extra,
  };
}

function fixtureModel() {
  const repos: Record<string, RepoMeta> = {
    "1": repo(1, {
      owner: "ai",
      owner_type: "Organization",
      name: "torch-lib",
      full_name: "ai/torch-lib",
      description: "Machine learning library",
      language: "Python",
      topics: ["machine-learning", "library", "python"],
      current_stars: 120_000,
      crossed_10k: "2026-01-01",
    }),
    "2": repo(2, {
      owner: "py",
      name: "fast-api-tools",
      full_name: "py/fast-api-tools",
      description: "Python API toolkit",
      language: "Python",
      topics: ["python", "api", "tool"],
      current_stars: 80_000,
    }),
    "3": repo(3, {
      owner: "systems",
      name: "rust-cli",
      full_name: "systems/rust-cli",
      description: "Command line utility",
      language: "Rust",
      topics: ["rust", "cli"],
      current_stars: 40_000,
    }),
  };
  const raw = {
    repos,
    monthly: {
      "1": [["2026-01", 100], ["2026-02", 80]],
      "2": [["2026-01", 50], ["2026-02", 200]],
      "3": [["2026-01", 500], ["2026-02", 10]],
    },
    weekly: {},
    recentDaily: {},
    siteDailyByYear: {},
  } as unknown as RawShards;
  return buildModel(raw, "");
}

describe("computeCategoryViews", () => {
  const views = computeCategoryViews(fixtureModel(), GEN);

  test("emits registry, assignments, and lookup artifacts", () => {
    expect(views.has("categories/registry.json")).toBe(true);
    expect(views.has("categories/assignments.json")).toBe(true);
    expect(views.has("lookup/categories.json")).toBe(true);
  });

  test("registry counts language categories and keeps curated language pages public", () => {
    const registry = views.get("categories/registry.json") as {
      dimensions: Array<{ id: string; categories: Array<{ id: string; count: number; public: boolean; sitemap: boolean }> }>;
    };
    const language = registry.dimensions.find((dimension) => dimension.id === "language")!;
    const python = language.categories.find((category) => category.id === "language/python")!;
    const rust = language.categories.find((category) => category.id === "language/rust")!;

    expect(python).toMatchObject({ count: 2, public: true, sitemap: true });
    expect(rust).toMatchObject({ count: 1, public: true, sitemap: true });
  });

  test("hides low-volume non-curated categories from public lookup and ranks", () => {
    const registry = views.get("categories/registry.json") as {
      dimensions: Array<{ id: string; categories: Array<{ id: string; count: number; public: boolean; sitemap: boolean }> }>;
    };
    const lookup = views.get("lookup/categories.json") as {
      dimensions: Array<{ id: string; categories: Array<{ id: string; sitemap?: boolean }> }>;
    };

    const domain = registry.dimensions.find((dimension) => dimension.id === "domain")!;
    const aiMl = domain.categories.find((category) => category.id === "domain/ai-ml")!;
    const lookupDomain = lookup.dimensions.find((dimension) => dimension.id === "domain")!;

    expect(aiMl).toMatchObject({ count: 1, public: false, sitemap: false });
    expect(lookupDomain.categories.some((category) => category.id === "domain/ai-ml")).toBe(false);
    expect(views.has("rank/category/domain/ai-ml/all-time/repo/stock.json")).toBe(false);
  });

  test("lookup carries sitemap eligibility for public categories", () => {
    const lookup = views.get("lookup/categories.json") as {
      dimensions: Array<{ id: string; categories: Array<{ id: string; sitemap?: boolean }> }>;
    };
    const language = lookup.dimensions.find((dimension) => dimension.id === "language")!;

    expect(language.categories.find((category) => category.id === "language/python")).toMatchObject({ sitemap: true });
  });

  test("assignments include every required single-value dimension", () => {
    const assignments = views.get("categories/assignments.json") as {
      repositories: Record<string, { language: string[]; language_family: string[]; owner_kind: string[]; domain: string[] }>;
    };
    expect(Object.keys(assignments.repositories).sort()).toEqual(["1", "2", "3"]);
    expect(assignments.repositories["1"].language).toEqual(["language/python"]);
    expect(assignments.repositories["1"].language_family).toEqual(["language_family/python"]);
    expect(assignments.repositories["1"].owner_kind).toEqual(["owner_kind/organization"]);
    expect(assignments.repositories["1"].domain).toContain("domain/ai-ml");
  });

  test("all-time category rank only includes assigned repos", () => {
    const rank = views.get("rank/category/language/python/all-time/repo/stock.json") as { items: Array<{ id: number; value: number }> };
    expect(rank.items.map((item) => item.id)).toEqual([1, 2]);
    expect(rank.items.map((item) => item.value)).toEqual([120_000, 80_000]);
  });

  test("does not emit period category ranks in phase 1", () => {
    expect(views.has("rank/category/language/python/month/2026-02/repo/flow.json")).toBe(false);
  });
});
