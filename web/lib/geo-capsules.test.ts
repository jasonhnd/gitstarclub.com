import { describe, expect, test } from "bun:test";
import { fallbackRegistry } from "@/app/categories/category-page-data";
import type { CategoryRegistry, OrgEntity, RepoEntity } from "@/lib/contracts";
import {
  buildAllTimeRankingCapsule,
  buildCategoryDetailCapsule,
  buildCategoryDimensionCapsule,
  buildCategoryIndexCapsule,
  buildCompareCapsule,
  buildOrgCapsule,
  buildPulseCapsule,
  buildRankingCapsule,
  buildRepoCapsule,
  capsuleWordCount,
  dataAsOfFromMeta,
  dataAsOfLabel,
  formatDataAsOf,
  resolveDataAsOfFromMeta,
  resolveDataAsOfLabel,
  visibleCapsuleSnapshot,
  type AnswerCapsuleContent,
} from "./geo-capsules";

const asOf = dataAsOfLabel("2026-06-24T12:00:00Z");

const repo = {
  id: 1,
  full_name: "react/react",
  owner: "react",
  owner_type: "Organization",
  name: "react",
  description: "The library for web and native user interfaces.",
  language: "JavaScript",
  languages: [{ name: "JavaScript", size: 100, color: "#f1e05a" }],
  topics: ["ui"],
  homepage_url: "https://react.dev",
  license: "MIT",
  latest_release: null,
  created_at: "2013-05-24",
  current_stars: 246000,
  is_archived: false,
  milestones: {
    crossed_10k: "2015-05-01",
    crossed_50k: "2017-01-01",
    crossed_100k: "2018-06-01",
  },
  curve: {
    monthly: [["2026-06", 1200, 246000]],
    recent_daily: [["2026-06-24", 45]],
  },
  monthly_table: [{ month: "2026-06", adds: 1200, rank: 4 }],
  rank_history: {},
  inflections: [],
} satisfies RepoEntity;

const org = {
  login: "vercel",
  owner_type: "Organization",
  current_stars_sum: 400000,
  repo_count: 42,
  members: [1, 2],
  curve: {
    monthly: [["2026-06", 2000, 400000]],
    recent_daily: [["2026-06-24", 70]],
  },
  rank_history: {},
} satisfies OrgEntity;

const rankRows = [
  { owner: "react", name: "react", gained: 1200, total: 246000 },
  { owner: "vuejs", name: "vue", gained: 900, total: 208000 },
  { owner: "angular", name: "angular", gained: 700, total: 98000 },
];

const registry = {
  rules_version: "2026-06-01",
  generated_at: "2026-06-24T12:00:00Z",
  dimensions: [
    {
      id: "language",
      label: "Languages",
      categories: [
        {
          id: "language/javascript",
          dimension: "language",
          slug: "javascript",
          label: "JavaScript",
          count: 214,
          public: true,
          sitemap: true,
          minimum_repo_count: 3,
        },
        {
          id: "language/python",
          dimension: "language",
          slug: "python",
          label: "Python",
          count: 175,
          public: true,
          sitemap: true,
          minimum_repo_count: 3,
        },
      ],
    },
    {
      id: "ecosystem",
      label: "Ecosystems",
      categories: [],
    },
    {
      id: "domain",
      label: "Domains",
      categories: [],
    },
  ],
} satisfies CategoryRegistry;

const capsules: AnswerCapsuleContent[] = [
  buildRepoCapsule(repo, asOf),
  buildOrgCapsule(org, asOf),
  buildRankingCapsule({ title: "June 2026 GitHub Star Rankings", asOf, rows: rankRows, metric: "gained" }),
  buildAllTimeRankingCapsule({ asOf, repoRows: rankRows, orgRows: [{ login: "vercel", current_stars_sum: 400000, repo_count: 42 }] }),
  buildCategoryIndexCapsule(registry, asOf),
  buildCategoryDimensionCapsule(registry.dimensions[0], asOf),
  buildCategoryDetailCapsule({ category: registry.dimensions[0].categories[0], asOf, rows: rankRows }),
  buildPulseCapsule({ asOf, weekRows: rankRows, monthRows: rankRows.slice().reverse() }),
  buildCompareCapsule(asOf),
];

describe("GEO answer capsules", () => {
  test("formats data-as-of labels from real data fields", () => {
    expect(formatDataAsOf("2026-06-24T12:00:00Z")).toBe("June 24, 2026");
    expect(formatDataAsOf("2026-06-24")).toBe("June 24, 2026");
    expect(formatDataAsOf("2026-06")).toBe("June 2026");
    expect(dataAsOfFromMeta({ seam_date: "2020-01-01", schema_ver: 1, folded_through: { month: "2026-06", week: "2026-W25" } })).toBe("June 2026");
    expect(() => dataAsOfLabel("fallback")).toThrow("GEO answer capsule requires a real data-as-of date");
  });

  test("resolves fallback category registry dates from a real secondary watermark without throwing", () => {
    const registryFallback = fallbackRegistry();
    expect(registryFallback.generated_at).toBe("fallback");
    expect(() => resolveDataAsOfLabel(registryFallback.generated_at, "2026-06-24T12:00:00Z")).not.toThrow();
    expect(resolveDataAsOfLabel(registryFallback.generated_at, "2026-06-24T12:00:00Z")).toBe("June 24, 2026");
    expect(resolveDataAsOfLabel(registryFallback.generated_at)).toBeNull();
  });

  test("dateless meta uses the non-throwing skip path for optional capsules", () => {
    const datelessMeta = { seam_date: "2020-01-01", schema_ver: 1 };
    const asOfFromDatelessMeta = resolveDataAsOfFromMeta(datelessMeta);
    expect(asOfFromDatelessMeta).toBeNull();
    expect(() => (asOfFromDatelessMeta ? buildCompareCapsule(asOfFromDatelessMeta) : null)).not.toThrow();
    expect(() => (asOfFromDatelessMeta ? buildRepoCapsule(repo, asOfFromDatelessMeta) : null)).not.toThrow();
    expect(() => (asOfFromDatelessMeta ? buildOrgCapsule(org, asOfFromDatelessMeta) : null)).not.toThrow();
  });

  test("keeps every deterministic capsule within the 40-60 word target", () => {
    for (const capsule of capsules) {
      expect(capsuleWordCount(capsule)).toBeGreaterThanOrEqual(40);
      expect(capsuleWordCount(capsule)).toBeLessThanOrEqual(60);
    }
  });

  test("snapshots visible repo capsule and data-as-of block", () => {
    expect(visibleCapsuleSnapshot(buildRepoCapsule(repo, asOf))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, react/react has 246.0k GitHub stars. GitStarClub tracks its JavaScript profile, 10k in May 2015, 50k in January 2017, and 100k in June 2018, and latest recorded month of June 2026 with +1.2k stars, combining identity, milestone, current-star, and monthly curve fields for answerable repository history without runtime inference. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
  });

  test("snapshots visible org and rankings capsules", () => {
    expect(visibleCapsuleSnapshot(buildOrgCapsule(org, asOf))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, vercel has 400.0k total GitHub stars across 42 tracked repositories. GitStarClub builds this organization page from precomputed organization JSON, member repository ids, current-star sums, and monthly curves so readers can cite organization momentum without a runtime database. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildRankingCapsule({ title: "June 2026 GitHub Star Rankings", asOf, rows: rankRows, metric: "gained" }))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, June 2026 GitHub Star Rankings ranks tracked GitHub repositories by stars gained. react/react leads with +1.2k stars, followed by vuejs/vue and angular/angular. GitStarClub generates this visible ranking from precomputed rank JSON and lookup joins, with no runtime search, database, or AI. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildAllTimeRankingCapsule({ asOf, repoRows: rankRows, orgRows: [{ login: "vercel", current_stars_sum: 400000, repo_count: 42 }] }))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub's all-time rankings summarize the largest tracked GitHub repositories and organizations. react/react leads repositories with 246.0k total stars, while vercel leads organizations with 400.0k total stars. The page is built from precomputed all-time rank JSON plus repository and organization lookup fields. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
  });

  test("snapshots visible category, pulse, and compare capsules", () => {
    expect(visibleCapsuleSnapshot(buildCategoryIndexCapsule(registry, asOf))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub organizes tracked GitHub repositories into 2 public categories across 3 dimensions, including languages, ecosystems, domains. These links come from deterministic category registry JSON and help readers reach focused repository lists without relying only on sitemap discovery. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildCategoryDimensionCapsule(registry.dimensions[0], asOf))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub lists 2 public categories in the languages dimension for tracked GitHub repositories. This dimension page is generated from category registry JSON, with deterministic counts and crawlable links so readers and answer engines can move from broad taxonomy to specific repository rankings. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildCategoryDetailCapsule({ category: registry.dimensions[0].categories[0], asOf, rows: rankRows }))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub tracks 214 repositories in JavaScript. react/react leads with 246.0k total stars, followed by vuejs/vue and angular/angular. This category ranking is generated from deterministic category assignment JSON, all-time stock ranking data, and repository lookup fields, not live search or AI. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildPulseCapsule({ asOf, weekRows: rankRows, monthRows: rankRows.slice().reverse() }))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub Pulse summarizes current open-source momentum across tracked repositories. react/react leads the latest available week with +1.2k stars, while angular/angular leads the current month-to-date list with +700 stars. The page is generated from hot-snapshot and rank JSON so the visible summary stays deterministic, dated, and free of runtime analysis. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
    expect(visibleCapsuleSnapshot(buildCompareCapsule(asOf))).toBe(
      [
        "Answer capsule",
        "As of June 24, 2026, GitStarClub Compare lets readers overlay tracked repository star-history curves from precomputed repo-curve JSON. The static page explains absolute calendar history and 10k-aligned comparison without claiming client-only query-state facts as server-rendered evidence, keeping citation copy deterministic and reviewable. — GitStarClub",
        "Data as of: June 24, 2026",
        "Source: GitStarClub",
      ].join("\n"),
    );
  });
});
