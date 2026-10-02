import {
  GENERATED_AT,
  REPO_ID,
  REPO_FULL_NAME,
  REPO_OWNER,
  REPO_NAME,
  ORG_LOGIN,
  RANKING_YEAR,
  RANKING_MONTH,
  RANKING_WEEK,
  CATEGORY_DIMENSION,
  CATEGORY_SLUG,
  rankFixture,
  categoryRankFixture,
  heatmapFixture,
  repoIdByFullNameFixture,
  joinRepoRank,
  joinOrgRank,
  metaFixture,
  reposLookupFixture,
  orgsLookupFixture,
  repoEntityFixture,
  repoCurveFixture,
  orgEntityFixture,
  categoryRegistryFixture,
  categoryAssignmentsFixture,
  hotSnapshotFixture,
  emptyRepoEntityFixture,
  emptyOrgEntityFixture,
  emptyCategoryRegistryFixture,
  emptyCategoryAssignmentsFixture,
  emptyHotSnapshotFixture,
} from "./fixtures/uiux-seo";
import { viewKey } from "@/lib/integration/fixtures/view-key";
import { decodeHtml } from "@/lib/integration/fixtures/html";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { SearchPanel } from "@/app/_explore/search-box/SearchPanel";
import { fmtStars } from "@/lib/format";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";

type FixtureMode = "normal" | "repo-empty" | "org-empty" | "ranking-empty" | "category-empty" | "pulse-empty";
let fixtureMode: FixtureMode = "normal";

mock.module("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`);
  },
  usePathname: () => "/",
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
    replace: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
}));

mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getAliasMapDaily: async () => ({}),
  getAllTime: async (dim: "repo" | "org") => rankFixture("all", "all", dim, "stock"),
  getCategoryAllTimePage: async (dimension: string, slug: string) => categoryRankFixture(dimension, slug),
  getCategoryAssignments: async () => (fixtureMode === "repo-empty" ? emptyCategoryAssignmentsFixture() : categoryAssignmentsFixture),
  getCategoryAssignmentsForRepos: async () => (fixtureMode === "repo-empty" ? emptyCategoryAssignmentsFixture() : categoryAssignmentsFixture),
  getCategoryRegistry: async () => (fixtureMode === "category-empty" ? emptyCategoryRegistryFixture() : categoryRegistryFixture),
  getHeatmap: async (scope: "year" | "month", period: string) => (fixtureMode === "ranking-empty" ? { ...heatmapFixture(scope, period), cells: [] } : heatmapFixture(scope, period)),
  getHotSnapshot: async () => (fixtureMode === "pulse-empty" ? emptyHotSnapshotFixture() : hotSnapshotFixture),
  getMeta: async () => metaFixture,
  getOrgEntityDaily: async (login: string) => (login === ORG_LOGIN ? (fixtureMode === "org-empty" ? emptyOrgEntityFixture() : orgEntityFixture) : null),
  getOrgsLookup: async () => orgsLookupFixture,
  getRank: async (window: "year" | "month" | "week", period: string, dim: "repo" | "org", metric: "flow" | "stock" | "growth" | "new") => {
    const rank = rankFixture(window, period, dim, metric);
    return fixtureMode === "pulse-empty" || (fixtureMode === "ranking-empty" && (metric === "growth" || metric === "new")) ? { ...rank, items: [] } : rank;
  },
  getRepoCurve: async (id: number) => (id === REPO_ID ? repoCurveFixture : null),
  getRepoEntityDaily: async (id: number) => (id === REPO_ID ? repoEntityFixture : null),
  getRepoPageEntityDaily: async (id: number) => (id === REPO_ID ? (fixtureMode === "repo-empty" ? emptyRepoEntityFixture() : repoEntityFixture) : null),
  getRepoIdByFullName: async () => repoIdByFullNameFixture(),
  getRepoIdByFullNameDaily: async () => repoIdByFullNameFixture(),
  getReposLookup: async () => reposLookupFixture,
  getReposLookupDaily: async () => (fixtureMode === "org-empty" ? {} : reposLookupFixture),
  joinOrgRank,
  joinRepoRank,
}));

const { AboutPageView, generateAboutMetadata } = await import("@/app/_localized/about");
const { CategoriesPageView, CategoryDetailPageView, CategoryDimensionPageView, generateCategoriesMetadata, generateCategoryDetailMetadataForLocale, generateCategoryDimensionMetadata } =
  await import("@/app/_localized/categories");
const { ComparePageView, generateCompareMetadata } = await import("@/app/_localized/compare");
const { generateOrgMetadata, OrgPageView } = await import("@/app/_localized/org");
const { generatePulseMetadata, PulsePageView } = await import("@/app/_localized/pulse");
const { generateRankingPeriodMetadata, generateRankingYearMetadata, RankingsPeriodPageView, RankingsYearPageView } = await import("@/app/_localized/ranking-detail");
const { generateRankingsMetadata, RankingsPageView } = await import("@/app/_localized/rankings");
const { generateRepoMetadata, RepoPageView } = await import("@/app/_localized/repo");

const BLOB_BASE_URL = "https://blob.test";
const VERSION = "uiux-seo";
const NOW = new Date("2026-07-08T12:00:00.000Z");

type PageCase = {
  label: string;
  metadata: () => Promise<Metadata>;
  render: () => Promise<ReactElement>;
};

type LocalizedSurfaceCase = {
  key: string;
  locale: Locale;
  surface: "repo" | "org" | "ranking" | "category" | "pulse";
  canonicalPath: string;
  expectedCompactValue: number;
  render: () => Promise<ReactElement>;
};

const pageCases: PageCase[] = [
  {
    label: "pulse",
    metadata: () => generatePulseMetadata({ locale: "en", canonicalPath: "/pulse" }),
    render: () => PulsePageView({ locale: "en", canonicalPath: "/pulse", now: NOW }),
  },
  {
    label: "rankings",
    metadata: () => generateRankingsMetadata("en"),
    render: () => RankingsPageView({ locale: "en", now: NOW }),
  },
  {
    label: "ranking year",
    metadata: () => generateRankingYearMetadata("en", RANKING_YEAR),
    render: () => RankingsYearPageView({ locale: "en", year: RANKING_YEAR, now: NOW }),
  },
  {
    label: "ranking month",
    metadata: () => generateRankingPeriodMetadata("en", { year: RANKING_YEAR, period: RANKING_MONTH }),
    render: () => RankingsPeriodPageView({ locale: "en", year: RANKING_YEAR, period: RANKING_MONTH }),
  },
  {
    label: "ranking week",
    metadata: () => generateRankingPeriodMetadata("en", { year: RANKING_YEAR, period: RANKING_WEEK }),
    render: () => RankingsPeriodPageView({ locale: "en", year: RANKING_YEAR, period: RANKING_WEEK }),
  },
  {
    label: "categories index",
    metadata: () => generateCategoriesMetadata("en"),
    render: () => CategoriesPageView({ locale: "en" }),
  },
  {
    label: "category dimension",
    metadata: () => generateCategoryDimensionMetadata("en", CATEGORY_DIMENSION),
    render: () => CategoryDimensionPageView({ locale: "en", dimension: CATEGORY_DIMENSION }),
  },
  {
    label: "category detail",
    metadata: () => generateCategoryDetailMetadataForLocale("en", { dimension: CATEGORY_DIMENSION, slug: CATEGORY_SLUG }),
    render: () => CategoryDetailPageView({ locale: "en", dimension: CATEGORY_DIMENSION, slug: CATEGORY_SLUG, page: 1 }),
  },
  {
    label: "repo detail",
    metadata: () => generateRepoMetadata({ locale: "en", owner: REPO_OWNER, name: REPO_NAME }),
    render: () => RepoPageView({ locale: "en", owner: REPO_OWNER, name: REPO_NAME }),
  },
  {
    label: "org detail",
    metadata: () => generateOrgMetadata({ locale: "en", login: ORG_LOGIN }),
    render: () => OrgPageView({ locale: "en", login: ORG_LOGIN }),
  },
  {
    label: "compare",
    metadata: () => generateCompareMetadata("en"),
    render: () => ComparePageView({ locale: "en" }),
  },
  {
    label: "about",
    metadata: () => generateAboutMetadata("en"),
    render: () => AboutPageView({ locale: "en" }),
  },
];

const regressionLocales = ["ja", "zh", "fr"] as const satisfies readonly Locale[];
const localizedSurfaceCases: LocalizedSurfaceCase[] = regressionLocales.flatMap((locale) => [
  {
    key: `${locale}:repo`,
    locale,
    surface: "repo",
    canonicalPath: `/${REPO_FULL_NAME}`,
    expectedCompactValue: 210_000,
    render: () => RepoPageView({ locale, owner: REPO_OWNER, name: REPO_NAME }),
  },
  {
    key: `${locale}:org`,
    locale,
    surface: "org",
    canonicalPath: `/o/${ORG_LOGIN}`,
    expectedCompactValue: 220_000,
    render: () => OrgPageView({ locale, login: ORG_LOGIN }),
  },
  {
    key: `${locale}:ranking`,
    locale,
    surface: "ranking",
    canonicalPath: `/rankings/${RANKING_YEAR}/${RANKING_MONTH}`,
    expectedCompactValue: 1_200,
    render: () => RankingsPeriodPageView({ locale, year: RANKING_YEAR, period: RANKING_MONTH }),
  },
  {
    key: `${locale}:category`,
    locale,
    surface: "category",
    canonicalPath: `/categories/${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`,
    expectedCompactValue: 210_000,
    render: () => CategoryDetailPageView({ locale, dimension: CATEGORY_DIMENSION, slug: CATEGORY_SLUG, page: 1 }),
  },
  {
    key: `${locale}:pulse`,
    locale,
    surface: "pulse",
    canonicalPath: "/pulse",
    expectedCompactValue: 210_000,
    render: () => PulsePageView({ locale, canonicalPath: "/pulse", now: NOW }),
  },
]);

let rendered = new Map<string, string>();
let localizedRendered = new Map<string, string>();
let localizedDictionaries = new Map<Locale, Dict>();
let metadata = new Map<string, Metadata>();
const originalFetch = globalThis.fetch;
const originalBlobBase = process.env.BLOB_BASE_URL;
const originalPublicBlobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

beforeAll(async () => {
  process.env.BLOB_BASE_URL = BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  globalThis.fetch = routeFixtureFetch as typeof fetch;

  const htmlEntries = await Promise.all(
    pageCases.map(async (page) => [page.label, await renderPage(await page.render())] as const),
  );
  rendered = new Map(htmlEntries);

  const localizedHtmlEntries = await Promise.all(
    localizedSurfaceCases.map(async (page) => [page.key, await renderPage(await page.render())] as const),
  );
  localizedRendered = new Map(localizedHtmlEntries);

  const dictionaryEntries = await Promise.all(
    regressionLocales.map(async (locale) => [locale, await getDictionary(locale)] as const),
  );
  localizedDictionaries = new Map(dictionaryEntries);

  const metadataEntries = await Promise.all(
    pageCases.map(async (page) => [page.label, await page.metadata()] as const),
  );
  metadata = new Map(metadataEntries);
});

afterAll(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
  if (originalBlobBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlobBase;
  if (originalPublicBlobBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBlobBase;
});

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

describe("Phase 7 UI/UX SEO metadata", () => {
  test("migrated surfaces expose non-empty unique titles and descriptions", () => {
    const titles = new Map<string, string>();

    for (const page of pageCases) {
      const meta = metadataFor(page.label);
      const title = metadataTitle(meta);
      const description = meta.description;

      expect(title, `${page.label} title`).toBeTruthy();
      expect(title.trim().length, `${page.label} title length`).toBeGreaterThan(0);
      expect(description, `${page.label} description`).toBeTruthy();
      expect(description?.trim().length ?? 0, `${page.label} description length`).toBeGreaterThan(0);

      const prior = titles.get(title);
      expect(prior, `${page.label} title duplicates ${prior ?? ""}`).toBeUndefined();
      titles.set(title, page.label);
    }
  });
});

describe("Phase 7 UI/UX JSON-LD and FAQ preservation", () => {
  for (const page of pageCases) {
    test(`${page.label} has parseable JSON-LD and visible FAQ content`, () => {
      const html = htmlFor(page.label);
      const blocks = jsonLdBlocks(html);

      expect(blocks.length, `${page.label} JSON-LD block count`).toBeGreaterThanOrEqual(1);
      for (const block of blocks) {
        const parsed = JSON.parse(block) as unknown;
        expect(parsed, `${page.label} JSON-LD parses`).toBeTruthy();
      }

      const faq = blocks.map((block) => JSON.parse(block) as JsonLdValue).find(isFaqPage);
      expect(faq, `${page.label} FAQPage JSON-LD`).toBeTruthy();
      const questions = faq?.mainEntity ?? [];
      expect(questions.length, `${page.label} FAQ count`).toBeGreaterThan(0);

      const visibleText = normalizedText(html);
      for (const entry of questions) {
        expect(visibleText, `${page.label} visible FAQ question: ${entry.name}`).toContain(normalizeSpace(entry.name));
        expect(visibleText, `${page.label} visible FAQ answer: ${entry.name}`).toContain(normalizeSpace(entry.acceptedAnswer.text));
      }
    });
  }
});

describe("GEO high-value answer capsules", () => {
  const asOfLabel = "June 4, 2026";

  for (const page of pageCases) {
    test(`${page.label} has a dated GitStarClub capsule from published metadata`, () => {
      const html = htmlFor(page.label);
      const visibleText = normalizedText(html);
      const capsule = html.indexOf('data-testid="answer-capsule"');
      const asOf = html.indexOf('data-testid="answer-capsule-data-as-of"');
      const source = html.indexOf('data-testid="answer-capsule-source"');

      expect(capsule, `${page.label} capsule`).toBeGreaterThan(-1);
      expect(asOf, `${page.label} data-as-of`).toBeGreaterThan(capsule);
      expect(source, `${page.label} source`).toBeGreaterThan(capsule);
      expect(visibleText, `${page.label} as-of date`).toContain(asOfLabel);
      expect(visibleText, `${page.label} attribution`).toContain("GitStarClub");
    });
  }

  test("pulse capsule sits after the period switcher and before ranking panels", () => {
    const html = htmlFor("pulse");
    const periodSwitcher = html.indexOf('aria-label="Ranking period"');
    const capsule = html.indexOf('data-testid="answer-capsule"');
    const weekPanel = html.indexOf("Top weekly repositories");
    const faq = html.indexOf('data-testid="faq"');

    expect(periodSwitcher).toBeGreaterThan(-1);
    expect(capsule).toBeGreaterThan(periodSwitcher);
    expect(weekPanel).toBeGreaterThan(capsule);
    expect(faq).toBeGreaterThan(weekPanel);
  });

  test("compare capsule stays generic and does not interpolate client query selections", () => {
    const html = htmlFor("compare");
    const start = html.indexOf('data-testid="answer-capsule"');
    const end = html.indexOf("</section>", start);
    const capsuleHtml = html.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(capsuleHtml).toContain("without claiming client-only query-state facts as server-rendered evidence");
    expect(capsuleHtml).not.toMatch(/\?repos=/);
    expect(capsuleHtml).not.toContain("vuejs/vue");
    expect(capsuleHtml).not.toContain("react/react");
  });
});

describe("localized repo, org, ranking, category, and pulse regressions", () => {
  const englishUiPhrases = [
    "Aggregate tracked stars",
    "Citable repository profile",
    "Latest available",
    "Permanent archive",
    "Ranking data is waiting for the next published recompute.",
    "Ranking period",
    "Repository facts",
    "Top repositories",
  ];

  for (const page of localizedSurfaceCases) {
    test(`${page.key} renders localized UI, locale-aware compact numbers, and localized JSON-LD`, () => {
      const html = localizedHtmlFor(page.key);
      const dictionary = localizedDictionaryFor(page.locale);
      const visibleText = normalizedText(html);
      const uiMarkup = decodedUiMarkup(html);

      expect(visibleText).toContain(surfaceMarker(dictionary, page.surface));
      expect(visibleText).toContain(normalizeSpace(fmtStars(page.expectedCompactValue, page.locale)));
      for (const phrase of englishUiPhrases) {
        expect(uiMarkup, `${page.key} leaked English UI: ${phrase}`).not.toContain(phrase);
      }

      const expectedPath = localizedPath(page.locale, page.canonicalPath);
      const values = jsonLdValues(html);
      const pageValues = values.filter((value) => jsonLdUrlPath(value) === expectedPath);
      expect(pageValues.length, `${page.key} localized JSON-LD URL`).toBeGreaterThan(0);
      expect(
        pageValues.some((value) => value.inLanguage === toBcp47Locale(page.locale)),
        `${page.key} localized JSON-LD language`,
      ).toBe(true);

      const faq = values.find(isFaqPage);
      expect(faq && jsonLdUrlPath(faq), `${page.key} localized FAQ URL`).toBe(expectedPath);
      if (page.surface === "ranking" || page.surface === "category" || page.surface === "pulse") {
        expect(
          values.some((value) => jsonLdIdPath(value) === expectedPath),
          `${page.key} localized Dataset @id`,
        ).toBe(true);
      }

      for (const value of values.filter(isListLd)) {
        for (const url of listItemUrls(value)) {
          const pathname = new URL(url).pathname;
          expect(
            pathname === `/${page.locale}` || pathname.startsWith(`/${page.locale}/`),
            `${page.key} localized JSON-LD list URL: ${pathname}`,
          ).toBe(true);
        }
      }

      const visibleInternalPaths = expectAnchors(html)
        .filter((href) => href.startsWith("/") && !href.startsWith("/api/") && !href.startsWith("/data/"))
        .map((href) => new URL(href, "https://gitstarclub.com").pathname);
      for (const pathname of visibleInternalPaths) {
        expect(
          pathname === `/${page.locale}` || pathname.startsWith(`/${page.locale}/`),
          `${page.key} localized visible link: ${pathname}`,
        ).toBe(true);
      }
    });
  }

  test("representative empty states and the search error state use the active dictionary", async () => {
    try {
      fixtureMode = "repo-empty";
      const ja = localizedDictionaryFor("ja");
      const repoHtml = await renderPage(await RepoPageView({ locale: "ja", owner: REPO_OWNER, name: REPO_NAME }));
      const repoText = normalizedText(repoHtml);
      for (const message of [ja.repo.noDescription, ja.repo.noLanguages, ja.repo.noTopics, ja.repo.noCategories, ja.repo.noRankingAppearances]) {
        expect(repoText).toContain(message);
      }

      fixtureMode = "org-empty";
      const zh = localizedDictionaryFor("zh");
      const orgHtml = await renderPage(await OrgPageView({ locale: "zh", login: ORG_LOGIN }));
      expect(normalizedText(orgHtml)).toContain(zh.org.trendUnavailable);
      expect(normalizedText(orgHtml)).toContain(zh.org.noTrackedRepos);

      fixtureMode = "ranking-empty";
      const fr = localizedDictionaryFor("fr");
      const rankingHtml = await renderPage(await RankingsPeriodPageView({ locale: "fr", year: RANKING_YEAR, period: RANKING_MONTH }));
      const rankingText = normalizedText(rankingHtml);
      expect(rankingText).toContain(fr.rankings.noMovement);
      expect(rankingText).toContain(fr.rankings.noGrowth);
      expect(rankingText).toContain(fr.rankings.noNewcomers);

      fixtureMode = "category-empty";
      const categoryHtml = await renderPage(await CategoriesPageView({ locale: "ja" }));
      expect(normalizedText(categoryHtml)).toContain(ja.categories.empty);

      fixtureMode = "pulse-empty";
      const pulseHtml = await renderPage(await PulsePageView({ locale: "zh", canonicalPath: "/pulse", now: NOW }));
      expect(normalizedText(pulseHtml)).toContain(zh.categories.rankingPending);

      const errorHtml = await renderPage(
        <SearchPanel
          compareSet={new Set()}
          hits={[]}
          labels={{
            ...fr.search,
            addToCompare: fr.compare.addToCompare,
            removeFromCompare: fr.compare.remove,
            openCompare: fr.compare.openCompare,
          }}
          loading={false}
          locale="fr"
          onOpenCompare={() => undefined}
          onReset={() => undefined}
          onResultKeyDown={() => undefined}
          onRetry={() => undefined}
          onToggleCompare={() => undefined}
          panelId="localized-search"
          searchFailed
        />,
      );
      expect(normalizedText(errorHtml)).toContain(fr.search.error);
      expect(normalizedText(errorHtml)).toContain(fr.search.retry);
      expect(decodedUiMarkup(errorHtml)).not.toContain("Search could not load.");
    } finally {
      fixtureMode = "normal";
    }
  });
});

describe("Phase 7 UI/UX internal-link anchors", () => {
  test("pulse links to rankings with a real anchor", () => {
    expect(expectAnchors(htmlFor("pulse"))).toContain("/rankings");
  });

  test("rankings links to a year archive with a real anchor", () => {
    expect(expectAnchors(htmlFor("rankings"))).toContain(`/rankings/${RANKING_YEAR}`);
  });

  test("year archive links to a month archive with a real anchor", () => {
    expect(expectAnchors(htmlFor("ranking year")).some((href) => /^\/rankings\/2024\/\d+$/.test(href))).toBe(true);
  });

  test("all-time and period rankings link to a public category", () => {
    expect(expectAnchors(htmlFor("rankings"))).toContain(`/categories/${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`);
    expect(expectAnchors(htmlFor("ranking year"))).toContain(`/categories/${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`);
    expect(expectAnchors(htmlFor("ranking month"))).toContain(`/categories/${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`);
    expect(normalizedText(htmlFor("rankings")).toLowerCase()).not.toContain("filter github");
  });

  test("category detail links to a repository with a real anchor", () => {
    expect(expectAnchors(htmlFor("category detail"))).toContain(`/${REPO_FULL_NAME}`);
  });

  test("thin category detail states whitelist-slice honesty", () => {
    const text = normalizedText(htmlFor("category detail"));
    expect(text).toContain("whitelist slice");
    expect(text.toLowerCase()).not.toContain("complete language ecosystem");
    expect(text.toLowerCase()).not.toContain("complete github catalog of");
  });

  test("repo detail links to its owner with a real anchor", () => {
    expect(expectAnchors(htmlFor("repo detail"))).toContain(`/o/${REPO_OWNER}`);
  });
});

type JsonLdValue = {
  "@id"?: unknown;
  "@type"?: unknown;
  inLanguage?: unknown;
  itemListElement?: unknown;
  mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
  url?: unknown;
};

function htmlFor(label: string): string {
  const html = rendered.get(label);
  if (!html) throw new Error(`missing rendered page: ${label}`);
  return html;
}

function localizedHtmlFor(key: string): string {
  const html = localizedRendered.get(key);
  if (!html) throw new Error(`missing localized rendered page: ${key}`);
  return html;
}

function localizedDictionaryFor(locale: Locale): Dict {
  const dictionary = localizedDictionaries.get(locale);
  if (!dictionary) throw new Error(`missing localized dictionary: ${locale}`);
  return dictionary;
}

function surfaceMarker(dictionary: Dict, surface: LocalizedSurfaceCase["surface"]): string {
  if (surface === "repo") return dictionary.repo.profileEyebrow;
  if (surface === "org") return dictionary.org.aggregateTrackedStars;
  if (surface === "ranking") return dictionary.rankings.permanentArchive;
  if (surface === "category") return dictionary.categories.topRepositories;
  return dictionary.pulse.title;
}

function metadataFor(label: string): Metadata {
  const meta = metadata.get(label);
  if (!meta) throw new Error(`missing metadata: ${label}`);
  return meta;
}

function metadataTitle(meta: Metadata): string {
  if (typeof meta.title === "string") return meta.title;
  if (meta.title && typeof meta.title === "object") {
    if ("absolute" in meta.title && meta.title.absolute) return String(meta.title.absolute);
    if ("default" in meta.title && meta.title.default) return String(meta.title.default);
  }
  throw new Error(`unsupported metadata title: ${JSON.stringify(meta.title)}`);
}

function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) blocks.push(decodeHtml(match[1].trim()));
  return blocks;
}

function jsonLdValues(html: string): JsonLdValue[] {
  return jsonLdBlocks(html).map((block) => JSON.parse(block) as JsonLdValue);
}

function jsonLdUrlPath(value: JsonLdValue): string | null {
  if (typeof value.url !== "string") return null;
  return new URL(value.url).pathname;
}

function jsonLdIdPath(value: JsonLdValue): string | null {
  if (typeof value["@id"] !== "string") return null;
  return new URL(value["@id"]).pathname;
}

function isListLd(value: JsonLdValue): boolean {
  return (value["@type"] === "ItemList" || value["@type"] === "BreadcrumbList") && Array.isArray(value.itemListElement);
}

function listItemUrls(value: JsonLdValue): string[] {
  if (!Array.isArray(value.itemListElement)) return [];
  return value.itemListElement.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("item" in entry)) return [];
    const item = entry.item;
    if (typeof item === "string") return [item];
    if (!item || typeof item !== "object" || !("url" in item) || typeof item.url !== "string") return [];
    return [item.url];
  });
}

function isFaqPage(value: JsonLdValue): value is Required<JsonLdValue> {
  return value["@type"] === "FAQPage" && Array.isArray(value.mainEntity);
}

function expectAnchors(html: string): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeHtml(match[1]));
  expect(anchors.length).toBeGreaterThan(0);
  return anchors;
}

function normalizedText(html: string): string {
  return normalizeSpace(
    decodeHtml(
      html
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function decodedUiMarkup(html: string): string {
  return decodeHtml(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " "));
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function routeFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const key = viewKey(input, VERSION);
  const body = fixtureForView(key);
  if (body === null) return new Response("not found", { status: 404 });
  return Response.json(body);
}

function fixtureForView(path: string): unknown | null {
  if (path === "views/latest.json") {
    return {
      version: VERSION,
      run_id: "uiux-seo",
      published_at: GENERATED_AT,
      prev_version: null,
      schema_ver: 1,
    };
  }
  if (path === "meta.json") return metaFixture;
  if (path === "lookup/repos.json") return reposLookupFixture;
  if (path === "lookup/orgs.json") return orgsLookupFixture;
  if (path === "lookup/aliases.json") return {};
  if (path === "hot-snapshot.json") return hotSnapshotFixture;
  if (path === "categories/registry.json") return categoryRegistryFixture;
  if (path === "categories/assignments.json") return categoryAssignmentsFixture;
  if (path === `entity/repo/${REPO_ID}.json`) return repoEntityFixture;
  if (path === `entity/org/${ORG_LOGIN}.json`) return orgEntityFixture;

  const liveRank = path.match(/^live\/rank\/(week|month)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (liveRank) return rankFixture(liveRank[1], liveRank[2], liveRank[3], liveRank[4]);

  const rank = path.match(/^rank\/(year|month|week)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (rank) return rankFixture(rank[1], rank[2], rank[3], rank[4]);

  const allTimeRank = path.match(/^rank\/all-time\/(repo|org)\/stock\.json$/);
  if (allTimeRank) return rankFixture("all", "all", allTimeRank[1], "stock");

  const categoryRank = path.match(/^rank\/category\/([^/]+)\/([^/]+)\/all-time\/repo\/stock(?:\/page\/\d+)?\.json$/);
  if (categoryRank) return categoryRankFixture(categoryRank[1], categoryRank[2]);

  const liveHeatmap = path.match(/^live\/heatmap\/(year|month)\/([^/]+)\.json$/);
  if (liveHeatmap) return heatmapFixture(liveHeatmap[1], liveHeatmap[2]);

  const heatmap = path.match(/^heatmap\/(year|month)\/([^/]+)\.json$/);
  if (heatmap) return heatmapFixture(heatmap[1], heatmap[2]);

  return null;
}
