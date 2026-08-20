import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import type { CategoryRegistry, OrgEntity, RepoEntity } from "@/lib/contracts";
import type { FaqItem } from "@/lib/jsonld";
import { dataAsOfLabel } from "./geo-capsules";
import {
  buildAllTimeRankingFaqs,
  buildCategoryDetailFaqs,
  buildCategoryDimensionFaqs,
  buildCategoryIndexFaqs,
  buildCompareFaqs,
  buildOrgFaqs,
  buildPulseFaqs,
  buildRankingFaqs,
  buildRepoFaqs,
  visibleFaqPairs,
  visibleFaqSnapshot,
} from "./geo-faq";

const asOf = "June 24, 2026";

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

const orgRows = [{ login: "vercel", current_stars_sum: 400000, repo_count: 42 }];

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
      categories: [
        {
          id: "ecosystem/react",
          dimension: "ecosystem",
          slug: "react",
          label: "React",
          count: 55,
          public: true,
          sitemap: true,
          minimum_repo_count: 3,
        },
      ],
    },
  ],
} satisfies CategoryRegistry;

const scenarios: Array<{ name: string; path: string; items: FaqItem[] }> = [
  { name: "repo", path: "/react/react", items: buildRepoFaqs(repo, asOf) },
  { name: "org", path: "/o/vercel", items: buildOrgFaqs(org, rankRows, asOf) },
  { name: "all-time ranking", path: "/rankings", items: buildAllTimeRankingFaqs({ asOf, repoRows: rankRows, orgRows }) },
  { name: "period ranking", path: "/rankings/2026/6", items: buildRankingFaqs({ title: "June 2026 GitHub Star Rankings", asOf, rows: rankRows, metric: "gained" }) },
  { name: "category index", path: "/categories", items: buildCategoryIndexFaqs(registry, asOf) },
  { name: "category dimension", path: "/categories/language", items: buildCategoryDimensionFaqs(registry.dimensions[0], asOf) },
  { name: "category detail", path: "/categories/language/javascript", items: buildCategoryDetailFaqs({ category: registry.dimensions[0].categories[0], asOf, rows: rankRows }) },
  { name: "pulse", path: "/pulse", items: buildPulseFaqs({ asOf, weekRows: rankRows, monthRows: rankRows.slice().reverse(), activeWeek: "2026-W25", activeMonth: "2026-06" }) },
  { name: "compare", path: "/compare", items: buildCompareFaqs(asOf) },
];

describe("GEO FAQ helpers", () => {
  test("build every target page type with 3-5 deterministic visible FAQ items", () => {
    for (const scenario of scenarios) {
      expect(scenario.items.length, scenario.name).toBeGreaterThanOrEqual(3);
      expect(scenario.items.length, scenario.name).toBeLessThanOrEqual(5);
      expect(new Set(scenario.items.map((item) => item.question)).size, scenario.name).toBe(scenario.items.length);
    }
  });

  test("does not throw when data-as-of metadata is missing", () => {
    expect(() => buildRepoFaqs(repo, null)).not.toThrow();
    expect(() => buildOrgFaqs(org, [], null)).not.toThrow();
    expect(() => buildAllTimeRankingFaqs({ asOf: null, repoRows: [], orgRows: [] })).not.toThrow();
    expect(() => buildRankingFaqs({ title: "Dateless GitHub Star Rankings", asOf: null, rows: [], metric: "gained" })).not.toThrow();
    expect(() => buildCategoryIndexFaqs(registry, null)).not.toThrow();
    expect(() => buildCategoryDimensionFaqs(registry.dimensions[0], null)).not.toThrow();
    expect(() => buildCategoryDetailFaqs({ category: registry.dimensions[0].categories[0], asOf: null, rows: [] })).not.toThrow();
    expect(() => buildPulseFaqs({ asOf: null, weekRows: [], monthRows: [], activeWeek: "2026-W25", activeMonth: "2026-06" })).not.toThrow();
    expect(() => buildCompareFaqs(null)).not.toThrow();
  });

  test("renders schema that exactly mirrors visible FAQ text", () => {
    for (const scenario of scenarios) {
      const html = renderFaq(scenario.items, scenario.path);
      expect(html).toContain('data-testid="faq"');
      expect(schemaPairsFromHtml(html), scenario.name).toEqual(visiblePairsFromHtml(html));
      expect(schemaPairsFromHtml(html), scenario.name).toEqual(visibleFaqPairs(scenario.items));
    }
  });

  test("keeps localized dates and grouped counts identical in visible FAQ and JSON-LD", () => {
    const asOfFr = dataAsOfLabel("2026-06-28T12:00:00Z", { locale: "fr" });
    const category = { ...registry.dimensions[0].categories[0], count: 1234 };
    const items = buildCategoryDetailFaqs({ category, asOf: asOfFr, rows: rankRows, locale: "fr" });
    const html = renderFaq(items, "/fr/categories/language/javascript", "fr");
    const pairs = schemaPairsFromHtml(html);

    expect(pairs).toEqual(visiblePairsFromHtml(html));
    expect(pairs[0][1]).toContain("28 juin 2026");
    expect(pairs[0][1]).toContain((1234).toLocaleString("fr-FR"));
  });

  test("escapes visible HTML and JSON-LD script text without changing parsed FAQ strings", () => {
    const items = [
      {
        question: 'Can FAQ text contain "<script>"?',
        answer: 'No raw x</script><img src=x onerror="alert(1)"> markup should survive visible HTML or script serialization.',
      },
    ];
    const html = renderFaq(items, "/faq-test");

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img src");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(schemaPairsFromHtml(html)).toEqual(visibleFaqPairs(items));
  });

  test("snapshots representative visible FAQ blocks", () => {
    expect(visibleFaqSnapshot(buildRepoFaqs(repo, asOf))).toBe(
      [
        "Frequently asked questions",
        "How many GitHub stars does react/react have?",
        "As of June 24, 2026, react/react has 246.0k GitHub stars. GitStarClub reads that value from GitStarClub's precomputed repository data.",
        "What language and owner does GitStarClub show for react/react?",
        "react/react is shown as a JavaScript repository owned by react. The page also links to the owner profile and matching category pages when those fields are present.",
        "When did react/react cross major star milestones?",
        "react/react crossed 10k in May 2015, 50k in January 2017, and 100k in June 2018 according to frozen milestone fields in GitStarClub's precomputed repository data.",
        "What is the latest monthly growth point for react/react?",
        "The latest precomputed monthly point for react/react says June 2026 recorded +1.2k stars and ended at 246.0k total stars. The chart and recent table are rendered from the same curve fields.",
        "Does this repository FAQ use live search or AI?",
        "No. GitStarClub renders this repository FAQ from deterministic templates over GitStarClub's precomputed data, without runtime AI, search, or a database.",
      ].join("\n"),
    );

    expect(visibleFaqSnapshot(buildAllTimeRankingFaqs({ asOf, repoRows: rankRows, orgRows }))).toBe(
      [
        "Frequently asked questions",
        "What do the all-time GitHub star rankings show?",
        "As of June 24, 2026, the all-time rankings list the largest tracked GitHub repositories and organizations by current total stars.",
        "Which repository leads the all-time ranking?",
        "react/react leads the visible repository ranking with 246.0k total stars.",
        "Which organization leads the all-time ranking?",
        "vercel leads the visible organization ranking with 400.0k total stars across 42 tracked repositories.",
        "What data powers the all-time ranking FAQ?",
        "GitStarClub builds this FAQ from GitStarClub's precomputed all-time ranking, repository, and organization data.",
      ].join("\n"),
    );

    expect(visibleFaqSnapshot(buildCategoryIndexFaqs(registry, asOf))).toBe(
      [
        "Frequently asked questions",
        "What are GitHub repository categories on GitStarClub?",
        "As of June 24, 2026, GitStarClub organizes tracked repositories into 3 public categories across 2 dimensions.",
        "Which category dimensions are available?",
        "The visible category dimensions are Languages and Ecosystems.",
        "Where do category counts come from?",
        "Category counts come from GitStarClub's own category data: deterministic rules over repository metadata, not live search or AI.",
        "How can readers move from categories to repositories?",
        "Readers can open a dimension such as Languages, then follow a category link to a ranked repository list.",
      ].join("\n"),
    );

    expect(visibleFaqSnapshot(buildCategoryDimensionFaqs(registry.dimensions[0], asOf))).toBe(
      [
        "Frequently asked questions",
        "What does the Languages category page include?",
        "As of June 24, 2026, the Languages page lists 2 public categories for tracked GitHub repositories.",
        "Which Languages category has the most tracked repositories?",
        "JavaScript is the largest visible Languages category with 214 tracked repositories.",
        "How are Languages category links generated?",
        "GitStarClub renders Languages links from the category registry, using public flags, slugs, labels, and counts that were precomputed before the request.",
        "Does the Languages page run client-side filtering?",
        "No. The Languages page is server-rendered and does not add client-side filtering logic for the visible FAQ or category links.",
      ].join("\n"),
    );
  });

  test("compare FAQ stays generic and does not treat client query state as server-rendered evidence", () => {
    const items = buildCompareFaqs(asOf);
    const snapshot = visibleFaqSnapshot(items);
    expect(snapshot).toContain("As of June 24, 2026");
    expect(snapshot).toContain("GitStarClub Compare");
    expect(snapshot).toContain("without claiming client-only query selections as server-rendered evidence");
    expect(snapshot).not.toMatch(/\?repos=/);
    expect(items.some((item) => item.answer.includes("react/react") && item.answer.includes("selected"))).toBe(false);
  });

  test("high-value FAQ builders keep a dated GitStarClub answer when as-of metadata exists", () => {
    for (const scenario of scenarios) {
      expect(scenario.items.some((item) => item.answer.includes(asOf) || item.answer.includes("GitStarClub")), scenario.name).toBe(true);
      expect(scenario.items.some((item) => item.answer.includes("?repos=")), scenario.name).toBe(false);
    }
  });
});

function renderFaq(items: readonly FaqItem[], path: string, locale = "en"): string {
  return renderToStaticMarkup(createElement(FaqBlock, { items, path, locale }));
}

function schemaPairsFromHtml(html: string): Array<[string, string]> {
  const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  if (!match) throw new Error("FAQ JSON-LD script was not rendered.");
  const parsed = JSON.parse(match[1]) as {
    mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
  };
  return parsed.mainEntity.map((entity) => [entity.name, entity.acceptedAnswer.text]);
}

function visiblePairsFromHtml(html: string): Array<[string, string]> {
  return [...html.matchAll(/<article\b[^>]*>.*?<h3[^>]*>(.*?)<\/h3>.*?<p[^>]*>(.*?)<\/p>.*?<\/article>/gs)].map((match) => [
    decodeHtmlText(match[1]),
    decodeHtmlText(match[2]),
  ]);
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
