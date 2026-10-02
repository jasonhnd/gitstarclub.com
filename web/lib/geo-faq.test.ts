import { afterAll, describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import {
  buildLocalizedCategoryDetailFaqs, buildLocalizedCategoryDimensionFaqs,
  buildLocalizedCategoryIndexFaqs, buildLocalizedRankingFaqs,
} from "@/app/_localized/detail-copy";
import {
  buildLocalizedAllTimeRankingFaqs, buildLocalizedCompareFaqs, buildLocalizedPulseFaqs,
} from "@/app/_localized/seo-copy";
import type { CategoryRegistry, Meta, OrgEntity, RepoEntity } from "@/lib/contracts";
import { LOCALES, type Locale } from "@/lib/i18n";
import { toBcp47Locale } from "@/lib/i18n/routing";
import type { FaqItem } from "@/lib/jsonld";
import { dataAsOfLabel } from "./geo-capsules";
import { visibleFaqPairs, visibleFaqSnapshot } from "./geo-faq";

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

let pageRepo: RepoEntity = repo;
let pageOrg: OrgEntity = org;
let pageMeta: Meta | null = { seam_date: "2020-01-01", schema_ver: 1, generated_at: "2026-06-24T12:00:00Z" };
const lookup = Object.fromEntries(rankRows.map((row, i) => [String(i + 1), {
  ...row, full_name: `${row.owner}/${row.name}`, owner_type: "Organization", language: "JavaScript", current_stars: row.total,
}]));

mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (location: string) => { throw new Error(`NEXT_REDIRECT:${location}`); },
  usePathname: () => "/react/react",
  useRouter: () => ({ back: () => undefined, forward: () => undefined, prefetch: () => undefined, push: () => undefined, refresh: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getAliasMapDaily: async () => ({}),
  getCategoryAssignmentsForRepos: async () => null,
  getCategoryRegistry: async () => registry,
  getMeta: async () => pageMeta,
  getOrgEntityDaily: async () => pageOrg,
  getRepoPageEntityDaily: async () => pageRepo,
  getRepoIdByFullNameDaily: async () => new Map([["react/react", 1]]),
  getReposLookupDaily: async () => lookup,
}));
afterAll(() => { mock.restore(); });
const { RepoPageView } = await import("@/app/_localized/repo");
const { OrgPageView } = await import("@/app/_localized/org");

function liveFaqs(locale: Locale, date: string | null = asOf, rows = rankRows) {
  return [
    { name: "all-time", path: "/rankings", items: buildLocalizedAllTimeRankingFaqs(locale, { asOf: date, repoRows: rows, orgRows: rows.length ? orgRows : [] }) },
    { name: "period", path: "/rankings/2026/6", items: buildLocalizedRankingFaqs({ locale, title: "June 2026 GitHub Star Rankings", asOf: date, rows, metric: "gained" }) },
    { name: "category index", path: "/categories", items: buildLocalizedCategoryIndexFaqs(locale, registry, date) },
    { name: "category dimension", path: "/categories/language", items: buildLocalizedCategoryDimensionFaqs(locale, registry.dimensions[0], date) },
    { name: "category detail", path: "/categories/language/javascript", items: buildLocalizedCategoryDetailFaqs({ locale, category: registry.dimensions[0].categories[0], asOf: date, rows }) },
    { name: "pulse", path: "/pulse", items: buildLocalizedPulseFaqs(locale, { asOf: date, weekRows: rows, monthRows: rows.slice().reverse(), activeWeek: "2026-W25", activeMonth: "2026-06" }) },
    { name: "compare", path: "/compare", items: buildLocalizedCompareFaqs(locale, date) },
  ];
}

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function faqSection(html: string): string {
  const section = html.match(/<section\b[^>]*data-testid="faq"[^>]*>.*?<\/section>/s)?.[0];
  if (!section) throw new Error("Live page did not render a FAQ section.");
  const script = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
    .find((match) => JSON.parse(match[1])["@type"] === "FAQPage")?.[0];
  if (!script) throw new Error("Live page did not render FAQ structured data.");
  return script + section;
}

function capsuleSection(html: string): string | null {
  return html.match(/<section\b[^>]*data-testid="answer-capsule"[^>]*>.*?<\/section>/s)?.[0] ?? null;
}

describe("production localized FAQ builders and rendered entity pages", () => {
  for (const locale of LOCALES) {
    test(`${locale} live FAQ text equals visible HTML and structured data`, () => {
      const date = dataAsOfLabel("2026-06-24T12:00:00Z", { locale });
      for (const rows of [rankRows, rankRows.slice(0, 1), []]) {
        for (const asOfValue of [date, null]) {
          for (const scenario of liveFaqs(locale, asOfValue, rows)) {
            const html = renderFaq(scenario.items, scenario.path, toBcp47Locale(locale));
            expect(scenario.items.length, scenario.name).toBeGreaterThanOrEqual(3);
            expect(scenario.items.length, scenario.name).toBeLessThanOrEqual(5);
            expect(new Set(scenario.items.map((item) => item.question)).size, scenario.name).toBe(scenario.items.length);
            expect(schemaPairsFromHtml(html), scenario.name).toEqual(visiblePairsFromHtml(html));
            expect(schemaPairsFromHtml(html), scenario.name).toEqual(visibleFaqPairs(scenario.items));
            expect(visibleFaqSnapshot(scenario.items)).not.toMatch(/\{\w+\}|\?repos=/);
            if (asOfValue) expect(scenario.items[0].answer).toContain(asOfValue);
          }
        }
      }
    });

    test(`${locale} repo and organization pages exercise their private live copy builders`, async () => {
      const date = dataAsOfLabel("2026-06-24T12:00:00Z", { locale });
      const pages = [
        await renderPage(await RepoPageView({ locale, owner: "react", name: "react" })),
        await renderPage(await OrgPageView({ locale, login: "vercel" })),
      ];
      for (const html of pages) {
        const section = faqSection(html);
        const pairs = schemaPairsFromHtml(section);
        expect(pairs).toEqual(visiblePairsFromHtml(section));
        expect(pairs.length).toBeGreaterThanOrEqual(3);
        expect(pairs[0][1]).toContain(date);
        expect(pairs.map((pair) => pair.join(" ")).join(" ")).not.toMatch(/\{\w+\}/);
        const capsule = capsuleSection(html);
        expect(capsule).not.toBeNull();
        expect(capsule).toContain(date);
        expect(capsule).toContain('data-testid="answer-capsule-source"');
        expect(capsule).toContain("GitStarClub");
      }
      if (locale === "en") {
        const repoPairs = schemaPairsFromHtml(faqSection(pages[0]));
        expect(repoPairs[0][1]).toContain("246.0k GitHub stars");
        expect(repoPairs.map((pair) => pair[1]).join(" ")).toContain("JavaScript");
        expect(repoPairs.map((pair) => pair[1]).join(" ")).toContain("June 2018");
        const orgPairs = schemaPairsFromHtml(faqSection(pages[1]));
        expect(orgPairs[0][1]).toContain("400.0k");
        expect(orgPairs[0][1]).toContain("42");
        expect(orgPairs.map((pair) => pair[1]).join(" ")).toContain("react/react");
      }
    });
  }

  test("entity pages skip undated capsules and render empty FAQs without inventing dates", async () => {
    const savedMeta = pageMeta;
    try {
      pageMeta = null;
      pageRepo = { ...repo, curve: { monthly: [], recent_daily: [] }, monthly_table: [] };
      pageOrg = { ...org, members: [], curve: { monthly: [], recent_daily: [] } };
      for (const html of [
        await renderPage(await RepoPageView({ locale: "en", owner: "react", name: "react" })),
        await renderPage(await OrgPageView({ locale: "en", login: "vercel" })),
      ]) {
        expect(capsuleSection(html)).toBeNull();
        const section = faqSection(html);
        expect(schemaPairsFromHtml(section)).toEqual(visiblePairsFromHtml(section));
        expect(section).not.toContain(asOf);
      }
    } finally {
      pageMeta = savedMeta;
      pageRepo = repo;
      pageOrg = org;
    }
  });

  test("live French category counts and dates match visible FAQ and structured data", () => {
    const date = dataAsOfLabel("2026-06-28T12:00:00Z", { locale: "fr" });
    const items = buildLocalizedCategoryDetailFaqs({ locale: "fr", category: { ...registry.dimensions[0].categories[0], count: 1234 }, asOf: date, rows: rankRows });
    const html = renderFaq(items, "/fr/categories/language/javascript", "fr");
    const pairs = schemaPairsFromHtml(html);
    expect(pairs).toEqual(visiblePairsFromHtml(html));
    expect(pairs[0][1]).toContain("28 juin 2026");
    expect(pairs[0][1]).toContain((1234).toLocaleString("fr-FR"));
  });

  test("escapes live interpolated labels in HTML and script serialization", () => {
    const category = { ...registry.dimensions[0].categories[0], label: 'x</script><img src=x onerror="alert(1)">' };
    const items = buildLocalizedCategoryDetailFaqs({ locale: "en", category, asOf, rows: rankRows });
    const html = renderFaq(items, "/faq-test");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img src");
    expect(html).not.toContain("</script><img");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(schemaPairsFromHtml(html)).toEqual(visibleFaqPairs(items));
    expect(schemaPairsFromHtml(html)).toEqual(visiblePairsFromHtml(html));
  });

  test("live compare FAQ remains static rather than describing client query selections", () => {
    const snapshot = visibleFaqSnapshot(buildLocalizedCompareFaqs("en", asOf));
    expect(snapshot).toContain("without claiming client-only query selections as server-rendered evidence");
    expect(snapshot).not.toMatch(/\?repos=/);
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
