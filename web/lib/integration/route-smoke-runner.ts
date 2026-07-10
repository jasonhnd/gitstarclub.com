import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import EnglishHomePage from "@/app/(en)/page";
import EnglishPulsePage from "@/app/(en)/pulse/page";
import EnglishRankingsPage from "@/app/(en)/rankings/page";
import EnglishRankingYearPage from "@/app/(en)/rankings/[year]/page";
import EnglishRankingPeriodPage from "@/app/(en)/rankings/[year]/[period]/page";
import EnglishCategoriesPage from "@/app/(en)/categories/page";
import EnglishCategoryDimensionPage from "@/app/(en)/categories/[dimension]/page";
import EnglishCategoryDetailPage from "@/app/(en)/categories/[dimension]/[slug]/page";
import EnglishCategoryDetailPagePage from "@/app/(en)/categories/[dimension]/[slug]/page/[page]/page";
import EnglishRepoPage from "@/app/(en)/[owner]/[name]/page";
import EnglishOrgPage from "@/app/(en)/o/[login]/page";
import EnglishComparePage from "@/app/(en)/compare/page";
import EnglishAboutPage from "@/app/(en)/about/page";
import LocalizedHomePage from "@/app/(localized)/[locale]/page";
import LocalizedRankingPeriodPage from "@/app/(localized)/[locale]/rankings/[year]/[period]/page";
import LocalizedRepoPage from "@/app/(localized)/[locale]/[owner]/[name]/page";
import { AboutPageView } from "@/app/_localized/about";
import { CategoriesPageView, CategoryDetailPageView, CategoryDimensionPageView } from "@/app/_localized/categories";
import { ComparePageView } from "@/app/_localized/compare";
import { OrgPageView } from "@/app/_localized/org";
import { PulsePageView } from "@/app/_localized/pulse";
import { RankingsPageView } from "@/app/_localized/rankings";
import { RankingsPeriodPageView, RankingsYearPageView } from "@/app/_localized/ranking-detail";
import { RepoPageView } from "@/app/_localized/repo";
import type {
  CategoriesLookup,
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  HotSnapshot,
  Meta,
  OrgEntity,
  OrgsLookup,
  RankList,
  RepoEntity,
  ReposLookup,
} from "@/lib/contracts";
import { CATEGORY_DETAIL_PAGE_SIZE } from "@/lib/pagination";
import { localeSitemapRoute } from "@/lib/sitemap-routes";

const BLOB_BASE_URL = "https://blob.test";
const VERSION = "route-smoke";
const GENERATED_AT = "2026-06-04T12:00:00.000Z";
const REPO_ID = 1;
const REPO_FULL_NAME = "vuejs/vue";
const BROKEN_REPO_ID = 259;
const BROKEN_REPO_FULL_NAME = "fighting41love/funNLP";
const ORG_LOGIN = "microsoft";
const CATEGORY_TOTAL_REPOS = CATEGORY_DETAIL_PAGE_SIZE + 3;

type RouteCase = {
  label: string;
  path: string;
  page: unknown;
  render: () => Promise<ReactElement>;
};

const routes: RouteCase[] = [
  {
    label: "home",
    path: "/",
    page: EnglishHomePage,
    render: () => PulsePageView({ locale: "en", canonicalPath: "/", includeWebsiteLd: true }),
  },
  {
    label: "pulse",
    path: "/pulse",
    page: EnglishPulsePage,
    render: () => PulsePageView({ locale: "en", canonicalPath: "/pulse" }),
  },
  {
    label: "all-time rankings",
    path: "/rankings",
    page: EnglishRankingsPage,
    render: () => RankingsPageView({ locale: "en" }),
  },
  {
    label: "ranking archive year",
    path: "/rankings/2024",
    page: EnglishRankingYearPage,
    render: () => RankingsYearPageView({ locale: "en", year: "2024" }),
  },
  {
    label: "ranking archive month",
    path: "/rankings/2024/6",
    page: EnglishRankingPeriodPage,
    render: () => RankingsPeriodPageView({ locale: "en", year: "2024", period: "6" }),
  },
  {
    label: "ranking archive week",
    path: "/rankings/2024/W10",
    page: EnglishRankingPeriodPage,
    render: () => RankingsPeriodPageView({ locale: "en", year: "2024", period: "W10" }),
  },
  {
    label: "categories index",
    path: "/categories",
    page: EnglishCategoriesPage,
    render: () => CategoriesPageView({ locale: "en" }),
  },
  {
    label: "category dimension",
    path: "/categories/language",
    page: EnglishCategoryDimensionPage,
    render: () => CategoryDimensionPageView({ locale: "en", dimension: "language" }),
  },
  {
    label: "category detail",
    path: "/categories/language/python",
    page: EnglishCategoryDetailPage,
    render: () => CategoryDetailPageView({ locale: "en", dimension: "language", slug: "python", page: 1 }),
  },
  {
    label: "category detail page 2",
    path: "/categories/language/python/page/2",
    page: EnglishCategoryDetailPagePage,
    render: () => CategoryDetailPageView({ locale: "en", dimension: "language", slug: "python", page: 2 }),
  },
  {
    label: "category detail with missing implied page shard",
    path: "/categories/domain/ai-ml",
    page: EnglishCategoryDetailPage,
    render: () => CategoryDetailPageView({ locale: "en", dimension: "domain", slug: "ai-ml", page: 1 }),
  },
  {
    label: "repo detail",
    path: `/${REPO_FULL_NAME}`,
    page: EnglishRepoPage,
    render: () => RepoPageView({ locale: "en", owner: "vuejs", name: "vue" }),
  },
  {
    label: "malformed linked repo detail",
    path: `/${BROKEN_REPO_FULL_NAME}`,
    page: EnglishRepoPage,
    render: () => RepoPageView({ locale: "en", owner: "fighting41love", name: "funNLP" }),
  },
  {
    label: "org detail",
    path: `/o/${ORG_LOGIN}`,
    page: EnglishOrgPage,
    render: () => OrgPageView({ locale: "en", login: ORG_LOGIN }),
  },
  {
    label: "compare",
    path: "/compare",
    page: EnglishComparePage,
    render: () => ComparePageView({ locale: "en" }),
  },
  {
    label: "about",
    path: "/about",
    page: EnglishAboutPage,
    render: () => AboutPageView({ locale: "en" }),
  },
  {
    label: "localized home",
    path: "/ja",
    page: LocalizedHomePage,
    render: () => PulsePageView({ locale: "ja", canonicalPath: "/", includeWebsiteLd: true }),
  },
  {
    label: "localized ranking archive month",
    path: "/zh-TW/rankings/2024/6",
    page: LocalizedRankingPeriodPage,
    render: () => RankingsPeriodPageView({ locale: "zh-TW", year: "2024", period: "6" }),
  },
  {
    label: "localized repo detail",
    path: `/fr/${REPO_FULL_NAME}`,
    page: LocalizedRepoPage,
    render: () => RepoPageView({ locale: "fr", owner: "vuejs", name: "vue" }),
  },
];

async function runRouteSmoke() {
  process.env.BLOB_BASE_URL = BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  globalThis.fetch = routeSmokeFetch as typeof fetch;

  for (const route of routes) {
    if (typeof route.page !== "function") {
      throw new Error(`${route.path} route module does not export a page function`);
    }

    let element: ReactElement;
    try {
      element = await route.render();
    } catch (error) {
      throw new Error(`${route.path} did not render as 200: ${routeErrorLabel(error)}`);
    }

    if (!isValidElement(element)) {
      throw new Error(`${route.path} did not render a React element`);
    }
  }

  await assertCategoryPaginationLinks();
  await assertSitemapCategoryPaginationUrls();

  console.log(`route smoke OK: ${routes.length} routes`);
}

async function routeSmokeFetch(input: RequestInfo | URL): Promise<Response> {
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
      run_id: "route-smoke",
      published_at: GENERATED_AT,
      prev_version: null,
      schema_ver: 1,
    };
  }
  if (path === "meta.json") return metaFixture;
  if (path === "lookup/repos.json") return reposLookupFixture;
  if (path === "lookup/orgs.json") return orgsLookupFixture;
  if (path === "lookup/categories.json") return categoriesLookupFixture;
  if (path === "lookup/aliases.json") return {};
  if (path === "hot-snapshot.json") return hotSnapshotFixture;
  if (path === "categories/registry.json") return categoryRegistryFixture;
  if (path === "categories/assignments.json") return categoryAssignmentsFixture;
  if (path === `entity/repo/${REPO_ID}.json`) return repoEntityFixture;
  if (path === `entity/repo/${BROKEN_REPO_ID}.json`) return brokenRepoEntityFixture;
  if (path === `entity/org/${ORG_LOGIN}.json`) return orgEntityFixture;

  const liveRank = path.match(/^live\/rank\/(week|month)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (liveRank) return rankFixture(liveRank[1], liveRank[2], liveRank[3], liveRank[4]);

  const rank = path.match(/^rank\/(year|month|week)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (rank) return rankFixture(rank[1], rank[2], rank[3], rank[4]);

  const allTimeRank = path.match(/^rank\/all-time\/(repo|org)\/stock\.json$/);
  if (allTimeRank) return rankFixture("all", "all", allTimeRank[1], "stock");

  const categoryRank = path.match(/^rank\/category\/([^/]+)\/([^/]+)\/all-time\/repo\/stock(?:\/page\/(\d+))?\.json$/);
  if (categoryRank) return categoryRankFixture(categoryRank[1], categoryRank[2], Number(categoryRank[3] ?? "1"));

  const liveHeatmap = path.match(/^live\/heatmap\/(year|month)\/([^/]+)\.json$/);
  if (liveHeatmap) return heatmapFixture(liveHeatmap[1], liveHeatmap[2]);

  const heatmap = path.match(/^heatmap\/(year|month)\/([^/]+)\.json$/);
  if (heatmap) return heatmapFixture(heatmap[1], heatmap[2]);

  return null;
}

function rankFixture(window: string, period: string, dim: string, metric: string): RankList {
  const repoItem = metric === "growth"
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

function categoryRankFixture(dimension: string, slug: string, page: number): CategoryRankList | null {
  if (dimension === "domain" && slug === "ai-ml" && page > 1) return null;

  const start = (page - 1) * CATEGORY_DETAIL_PAGE_SIZE + 1;
  if (start > CATEGORY_TOTAL_REPOS) return null;
  const length = Math.min(CATEGORY_DETAIL_PAGE_SIZE, CATEGORY_TOTAL_REPOS - start + 1);

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
    items: Array.from({ length }, (_, index) => {
      const rank = start + index;
      return { rank, id: rank, value: 300_000 - rank, prev_rank: null };
    }),
  };
}

async function assertCategoryPaginationLinks() {
  const pythonLinks = await categoryPaginationLinks("/categories/language/python");
  if (!pythonLinks.includes("/categories/language/python/page/2")) {
    throw new Error("/categories/language/python did not link its available page 2 shard");
  }

  const domainLinks = await categoryPaginationLinks("/categories/domain/ai-ml");
  if (domainLinks.some((path) => path.startsWith("/categories/domain/ai-ml/page/"))) {
    throw new Error(`/categories/domain/ai-ml linked unavailable pagination: ${domainLinks.join(", ")}`);
  }

  for (const path of [...pythonLinks, ...domainLinks]) await assertCategoryPaginationPathRenders(path, "linked pagination");
}

async function assertSitemapCategoryPaginationUrls() {
  const response = await localeSitemapRoute("en")();
  if (!response.ok) throw new Error(`sitemap-en.xml returned ${response.status}`);
  const paths = categoryPaginationPathsFromSitemap(await response.text());

  if (!paths.includes("/categories/language/python/page/2")) {
    throw new Error("sitemap-en.xml omitted available category page /categories/language/python/page/2");
  }
  if (paths.includes("/categories/domain/ai-ml/page/2")) {
    throw new Error("sitemap-en.xml included unavailable category page /categories/domain/ai-ml/page/2");
  }

  for (const path of paths) await assertCategoryPaginationPathRenders(path, "sitemap category pagination");
}

async function categoryPaginationLinks(path: string): Promise<string[]> {
  const element = await renderCategoryPath(path);
  return categoryPaginationPathsFromHtml(renderWithAppRouter(element));
}

async function assertCategoryPaginationPathRenders(path: string, source: string) {
  try {
    const element = await renderCategoryPath(path);
    if (!isValidElement(element)) throw new Error("did not render a React element");
  } catch (error) {
    throw new Error(`${source} path ${path} did not render as 200: ${routeErrorLabel(error)}`);
  }
}

async function renderCategoryPath(path: string): Promise<ReactElement> {
  const match = /^\/categories\/([^/]+)\/([^/]+)(?:\/page\/([1-9]\d*))?$/.exec(path);
  if (!match) throw new Error(`unsupported category path ${path}`);
  return CategoryDetailPageView({
    locale: "en",
    dimension: match[1],
    slug: match[2],
    page: match[3] ? Number(match[3]) : 1,
  });
}

function categoryPaginationPathsFromHtml(html: string): string[] {
  const paths = new Set<string>();
  const hrefs = html.matchAll(/href="([^"]+)"/g);
  for (const match of hrefs) {
    const href = decodeHtmlAttribute(match[1]);
    const path = href.startsWith("http://") || href.startsWith("https://") ? new URL(href).pathname : href;
    if (/^\/categories\/[^/]+\/[^/]+\/page\/[1-9]\d*$/.test(path)) paths.add(path);
  }
  return [...paths].sort();
}

function categoryPaginationPathsFromSitemap(xml: string): string[] {
  const paths = new Set<string>();
  const locs = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  for (const match of locs) {
    const path = new URL(decodeHtmlAttribute(match[1])).pathname;
    if (/^\/categories\/[^/]+\/[^/]+\/page\/[1-9]\d*$/.test(path)) paths.add(path);
  }
  return [...paths].sort();
}

function decodeHtmlAttribute(value: string): string {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

const appRouterStub = {
  back() {},
  forward() {},
  prefetch() {},
  push() {},
  replace() {},
  refresh() {},
  hmrRefresh() {},
};

function renderWithAppRouter(element: ReactElement): string {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: appRouterStub }, element));
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

function routeErrorLabel(error: unknown): string {
  if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string") {
    return error.digest;
  }
  return error instanceof Error ? error.message : String(error);
}

const metaFixture: Meta = {
  seam_date: "2026-06-01",
  schema_ver: 1,
  generated_at: GENERATED_AT,
  folded_through: { month: "2026-06", week: "2026-W23" },
};

const categoryRepoLookupFixture = Object.fromEntries(
  Array.from({ length: CATEGORY_TOTAL_REPOS }, (_, index) => {
    const id = index + 1;
    const owner = id === REPO_ID ? "vuejs" : `category-owner-${id}`;
    const name = id === REPO_ID ? "vue" : `category-repo-${id}`;
    return [
      String(id),
      {
        owner,
        name,
        full_name: `${owner}/${name}`,
        owner_type: "Organization",
        language: "Python",
        current_stars: 300_000 - id,
      },
    ];
  }),
) satisfies ReposLookup;

const reposLookupFixture: ReposLookup = {
  ...categoryRepoLookupFixture,
  [String(BROKEN_REPO_ID)]: {
    owner: "fighting41love",
    name: "funNLP",
    full_name: BROKEN_REPO_FULL_NAME,
    owner_type: "User",
    language: "Python",
    current_stars: 10_000,
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
  owner: "vuejs",
  owner_type: "Organization",
  name: "vue",
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
  rank_history: {},
  inflections: [],
};

const brokenRepoEntityFixture = {
  id: BROKEN_REPO_ID,
  full_name: BROKEN_REPO_FULL_NAME,
  owner: "fighting41love",
  owner_type: "User",
  name: "funNLP",
  description: null,
  language: "Python",
  languages: "Python",
  topics: null,
  homepage_url: "javascript:alert(1)",
  license: null,
  latest_release: { tag_name: "v1", url: "ftp://example.test/release" },
  created_at: "not-a-date",
  current_stars: 10_000,
  is_archived: false,
  milestones: null,
  curve: { monthly: null, recent_daily: "bad" },
  monthly_table: null,
  rank_history: { month: "bad" },
  inflections: "bad",
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
  rules_version: "route-smoke",
  generated_at: GENERATED_AT,
  dimensions: [
    {
      id: "language",
      label: "Language",
      categories: [
        {
          id: "language/python",
          dimension: "language",
          slug: "python",
          label: "Python",
          count: CATEGORY_TOTAL_REPOS,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
    {
      id: "domain",
      label: "Domain",
      categories: [
        {
          id: "domain/ai-ml",
          dimension: "domain",
          slug: "ai-ml",
          label: "AI / ML",
          count: CATEGORY_TOTAL_REPOS,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

const categoriesLookupFixture: CategoriesLookup = {
  rules_version: categoryRegistryFixture.rules_version,
  generated_at: categoryRegistryFixture.generated_at,
  dimensions: categoryRegistryFixture.dimensions.map((dimension) => ({
    id: dimension.id,
    label: dimension.label,
    categories: dimension.categories
      .filter((category) => category.public)
      .map((category) => ({
        id: category.id,
        slug: category.slug,
        label: category.label,
        count: category.count,
        sitemap: category.sitemap,
      })),
  })),
};

const categoryAssignmentsFixture: CategoryAssignments = {
  rules_version: "route-smoke",
  generated_at: GENERATED_AT,
  repositories: {
    [String(REPO_ID)]: {
      language: ["language/python"],
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
    year_spine: [["2026", 1_200]],
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

await runRouteSmoke();
