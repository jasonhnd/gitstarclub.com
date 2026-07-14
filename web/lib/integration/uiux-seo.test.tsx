import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type {
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  CompareCurve,
  HotSnapshot,
  Meta,
  OrgEntity,
  OrgsLookup,
  RankList,
  RepoEntity,
  ReposLookup,
} from "@/lib/contracts";

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

mock.module("@/lib/periods", () => ({
  FIRST_YEAR: 2015,
  currentUtcPeriods: () => ({
    year: 2026,
    month: 7,
    monthPeriod: "2026-07",
    week: { year: 2026, week: 28 },
    weekPeriod: "2026-W28",
  }),
  isoWeek,
}));

mock.module("@/lib/data", () => ({
  DAILY_BASE_VIEW_TTL_MS: 86_400_000,
  getAliasMapDaily: async () => ({}),
  getAllTime: async (dim: "repo" | "org") => rankFixture("all", "all", dim, "stock"),
  getCategoryAllTimePage: async (dimension: string, slug: string) => categoryRankFixture(dimension, slug),
  getCategoryAssignments: async () => categoryAssignmentsFixture,
  getCategoryRegistry: async () => categoryRegistryFixture,
  getHeatmap: async (scope: "year" | "month", period: string) => heatmapFixture(scope, period),
  getHotSnapshot: async () => hotSnapshotFixture,
  getMeta: async () => metaFixture,
  getOrgEntityDaily: async (login: string) => (login === ORG_LOGIN ? orgEntityFixture : null),
  getOrgsLookup: async () => orgsLookupFixture,
  getRank: async (window: "year" | "month" | "week", period: string, dim: "repo" | "org", metric: "flow" | "stock" | "growth" | "new") =>
    rankFixture(window, period, dim, metric),
  getRepoCurve: async (id: number) => (id === REPO_ID ? repoCurveFixture : null),
  getRepoEntityDaily: async (id: number) => (id === REPO_ID ? repoEntityFixture : null),
  getRepoPageEntityDaily: async (id: number) => (id === REPO_ID ? repoEntityFixture : null),
  getRepoIdByFullName: async () => repoIdByFullNameFixture(),
  getRepoIdByFullNameDaily: async () => repoIdByFullNameFixture(),
  getReposLookup: async () => reposLookupFixture,
  getReposLookupDaily: async () => reposLookupFixture,
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

function isoWeek(date: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

const BLOB_BASE_URL = "https://blob.test";
const VERSION = "uiux-seo";
const GENERATED_AT = "2026-06-04T12:00:00.000Z";
const REPO_ID = 1;
const REPO_FULL_NAME = "vuejs/vue";
const REPO_OWNER = "vuejs";
const REPO_NAME = "vue";
const ORG_LOGIN = "microsoft";
const RANKING_YEAR = "2024";
const RANKING_MONTH = "6";
const RANKING_WEEK = "W10";
const CATEGORY_DIMENSION = "language";
const CATEGORY_SLUG = "python";

type PageCase = {
  label: string;
  metadata: () => Promise<Metadata>;
  render: () => Promise<ReactElement>;
};

const pageCases: PageCase[] = [
  {
    label: "pulse",
    metadata: () => generatePulseMetadata({ locale: "en", canonicalPath: "/pulse" }),
    render: () => PulsePageView({ locale: "en", canonicalPath: "/pulse" }),
  },
  {
    label: "rankings",
    metadata: () => generateRankingsMetadata("en"),
    render: () => RankingsPageView({ locale: "en" }),
  },
  {
    label: "ranking year",
    metadata: () => generateRankingYearMetadata("en", RANKING_YEAR),
    render: () => RankingsYearPageView({ locale: "en", year: RANKING_YEAR }),
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

let rendered = new Map<string, string>();
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

  const metadataEntries = await Promise.all(
    pageCases.map(async (page) => [page.label, await page.metadata()] as const),
  );
  metadata = new Map(metadataEntries);
});

afterAll(() => {
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

  test("category detail links to a repository with a real anchor", () => {
    expect(expectAnchors(htmlFor("category detail"))).toContain(`/${REPO_FULL_NAME}`);
  });

  test("repo detail links to its owner with a real anchor", () => {
    expect(expectAnchors(htmlFor("repo detail"))).toContain(`/o/${REPO_OWNER}`);
  });
});

type JsonLdValue = {
  "@type"?: unknown;
  mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }>;
};

function htmlFor(label: string): string {
  const html = rendered.get(label);
  if (!html) throw new Error(`missing rendered page: ${label}`);
  return html;
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

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function routeFixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const key = viewKey(input);
  const body = fixtureForView(key);
  if (body === null) return new Response("not found", { status: 404 });
  return Response.json(body);
}

function viewKey(input: RequestInfo | URL): string {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  let path = url.pathname.replace(/^\/+/, "");
  const versionPrefix = `views/${VERSION}/`;
  if (path.startsWith(versionPrefix)) path = path.slice(versionPrefix.length);
  return path;
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

function rankFixture(window: string, period: string, dim: string, metric: string): RankList {
  const repoItem =
    metric === "growth"
      ? { rank: 1, id: REPO_ID, value: 15, prev_rank: null, rate: 1.5, base: 200_000 }
      : metric === "new"
        ? { rank: 1, id: REPO_ID, value: 10_000, prev_rank: null, date: "2024-06-01" }
        : { rank: 1, id: REPO_ID, value: metric === "stock" ? 210_000 : 1_200, prev_rank: null };
  const orgItem = { rank: 1, login: ORG_LOGIN, value: 220_000, prev_rank: null };

  return {
    meta: {
      window: window as RankList["meta"]["window"],
      period: period as RankList["meta"]["period"],
      dim: dim as RankList["meta"]["dim"],
      metric: metric as RankList["meta"]["metric"],
      generated_at: GENERATED_AT,
    },
    items: [dim === "repo" ? repoItem : orgItem],
  };
}

function categoryRankFixture(dimension: string, slug: string): CategoryRankList {
  return {
    meta: {
      window: "all",
      period: "all",
      dim: "repo",
      metric: "stock",
      generated_at: GENERATED_AT,
      category: {
        id: `${dimension}/${slug}` as CategoryRankList["meta"]["category"]["id"],
        dimension: dimension as CategoryRankList["meta"]["category"]["dimension"],
        slug,
      },
    },
    items: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  };
}

function heatmapFixture(scope: string, period: string) {
  return {
    meta: {
      scope,
      period,
      generated_at: GENERATED_AT,
    },
    cells: scope === "year" ? [[`${period}-01`, 1_200]] : [[`${period}-01`, 40]],
  };
}

type RepoRankItem = {
  id: number;
  value: number;
  rank?: number | null;
  prev_rank?: number | null;
  rate?: number;
  base?: number;
  date?: string;
};

type OrgRankItem = {
  login: string;
  value: number;
  rank?: number | null;
  prev_rank?: number | null;
};

function repoIdByFullNameFixture(): Map<string, number> {
  return new Map([[REPO_FULL_NAME.toLowerCase(), REPO_ID]]);
}

function joinRepoRank(items: readonly RepoRankItem[], lookup: ReposLookup) {
  return items.flatMap((item) => {
    const repo = lookup[String(item.id)];
    return repo ? [{ ...item, ...repo }] : [];
  });
}

function joinOrgRank(items: readonly OrgRankItem[], lookup: OrgsLookup) {
  return items.flatMap((item) => {
    const org = lookup[item.login];
    return org ? [{ ...item, ...org }] : [];
  });
}

const metaFixture: Meta = {
  seam_date: "2026-06-01",
  schema_ver: 1,
  generated_at: GENERATED_AT,
  folded_through: { month: "2026-06", week: "2026-W23" },
};

const reposLookupFixture: ReposLookup = {
  [String(REPO_ID)]: {
    owner: REPO_OWNER,
    name: REPO_NAME,
    full_name: REPO_FULL_NAME,
    owner_type: "Organization",
    language: "JavaScript",
    current_stars: 210_000,
  },
};

const orgsLookupFixture: OrgsLookup = {
  [ORG_LOGIN]: {
    login: ORG_LOGIN,
    owner_type: "Organization",
    repo_count: 1,
    current_stars_sum: 220_000,
  },
};

const repoEntityFixture: RepoEntity = {
  id: REPO_ID,
  full_name: REPO_FULL_NAME,
  owner: REPO_OWNER,
  owner_type: "Organization",
  name: REPO_NAME,
  description: "The progressive JavaScript framework.",
  language: "JavaScript",
  languages: [{ name: "JavaScript", size: 1000, color: "#f1e05a" }],
  topics: ["frontend"],
  homepage_url: "https://vuejs.org",
  license: "MIT",
  latest_release: {
    name: "Vue 3",
    tag_name: "v3.0.0",
    published_at: "2024-01-01",
    url: "https://github.com/vuejs/core/releases/tag/v3.0.0",
  },
  created_at: "2013-07-29",
  current_stars: 210_000,
  is_archived: false,
  milestones: {
    crossed_10k: "2015-01-01",
    crossed_50k: "2017-01-01",
    crossed_100k: "2018-01-01",
  },
  curve: {
    monthly: [
      ["2014-01", 5_000, 5_000],
      ["2015-01", 6_000, 11_000],
      ["2017-01", 40_000, 51_000],
      ["2018-01", 55_000, 106_000],
      ["2026-06", 1_200, 210_000],
    ],
    recent_daily: [["2026-06-04", 40]],
  },
  monthly_table: [{ month: "2026-06", adds: 1_200, rank: 1 }],
  rank_history: { month: [["2026-06", 1]] },
  inflections: [],
};

const repoCurveFixture: CompareCurve = {
  id: REPO_ID,
  full_name: REPO_FULL_NAME,
  current_stars: repoEntityFixture.current_stars,
  crossed_10k: repoEntityFixture.milestones.crossed_10k,
  points: repoEntityFixture.curve.monthly.map(([period, , total]) => [period, total]),
};

const orgEntityFixture: OrgEntity = {
  login: ORG_LOGIN,
  owner_type: "Organization",
  current_stars_sum: 220_000,
  repo_count: 1,
  members: [REPO_ID],
  curve: {
    monthly: [
      ["2024-01", 5_000, 100_000],
      ["2026-06", 1_200, 220_000],
    ],
    recent_daily: [["2026-06-04", 40]],
  },
  rank_history: {},
};

const categoryRegistryFixture: CategoryRegistry = {
  rules_version: "uiux-seo",
  generated_at: GENERATED_AT,
  dimensions: [
    {
      id: CATEGORY_DIMENSION,
      label: "Language",
      categories: [
        {
          id: `${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`,
          dimension: CATEGORY_DIMENSION,
          slug: CATEGORY_SLUG,
          label: "Python",
          count: 1,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

const categoryAssignmentsFixture: CategoryAssignments = {
  rules_version: "uiux-seo",
  generated_at: GENERATED_AT,
  repositories: {
    [String(REPO_ID)]: {
      language: [`${CATEGORY_DIMENSION}/${CATEGORY_SLUG}`],
      language_family: [],
      domain: [],
      project_type: [],
      ecosystem: [],
      owner_kind: ["owner_kind/organization"],
      maturity: [],
    },
  },
};

const hotSnapshotFixture: HotSnapshot = {
  generated_at: GENERATED_AT,
  home: {
    year_spine: [[RANKING_YEAR, 1_200]],
    current_month_top: {
      flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
      stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
    },
    on_this_day: [{ id: REPO_ID, crossed: "10k", date: "2015-01-01" }],
  },
  current_year: {
    flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  },
  current_month: {
    flow: [{ rank: 1, id: REPO_ID, value: 1_200, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
  },
  all_time: {
    repo: [{ rank: 1, id: REPO_ID, value: 210_000, prev_rank: null }],
    org: [{ rank: 1, login: ORG_LOGIN, value: 220_000, prev_rank: null }],
  },
};
