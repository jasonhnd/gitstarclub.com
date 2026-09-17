import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CategoryRegistry, Heatmap, OrgEntity, RankList, RepoEntity, ReposLookup } from "@/lib/contracts";
import { CategoryAssignments } from "@/lib/contracts";
import { splitCategoryAssignments } from "./category-assignment-shards";

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

const { RankingsPeriodPageView, RankingsYearPageView } = await import("@/app/_localized/ranking-detail");
const { RepoPageView } = await import("@/app/_localized/repo");
const { OrgPageView } = await import("@/app/_localized/org");

const BLOB_BASE_URL = "https://heavy-pages-cf-subrequests.test";
const VERSION = "heavy-pages-cf-subrequests";
const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-07-08T12:00:00.000Z");
const REPO_ID = 1;
const ORG_LOGIN = "vercel";
const originalFetch = globalThis.fetch;
const originalBlobBase = process.env.BLOB_BASE_URL;
const originalPublicBlobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
const originalHostingTarget = process.env.HOSTING_TARGET;
const originalPublicHostingTarget = process.env.NEXT_PUBLIC_HOSTING_TARGET;
const originalVercelEnv = process.env.VERCEL_ENV;

const assignment = {
  language: ["language/typescript"],
  language_family: [] as string[],
  domain: [] as string[],
  project_type: [] as string[],
  ecosystem: ["ecosystem/react"],
  owner_kind: ["owner_kind/organization"],
  maturity: [] as string[],
};

const assignments = CategoryAssignments.parse({
  rules_version: "test",
  generated_at: GENERATED_AT,
  repositories: { [String(REPO_ID)]: assignment },
});
const { index, shards } = splitCategoryAssignments(assignments);
const shardByPath = new Map(shards.map((shard) => [shard.path, shard.data]));

beforeAll(() => {
  process.env.BLOB_BASE_URL = BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalHostingTarget === undefined) delete process.env.HOSTING_TARGET;
  else process.env.HOSTING_TARGET = originalHostingTarget;
  if (originalPublicHostingTarget === undefined) delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
  else process.env.NEXT_PUBLIC_HOSTING_TARGET = originalPublicHostingTarget;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

afterAll(() => {
  if (originalBlobBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlobBase;
  if (originalPublicBlobBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBlobBase;
});

describe("CF ranking-detail / repo / org assignment shard budget", () => {
  test("issues 0 full 32-shard assignment reads and keeps language exits", async () => {
    process.env.HOSTING_TARGET = "cf";
    delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
    delete process.env.VERCEL_ENV;
    const probe = installFetchProbe();
    const pages = await renderHeavyPages();

    expect(probe.shardReads).toBe(0);
    expect(probe.paths.filter((path) => path.includes("categories/assignments"))).toEqual([]);
    expect(pages.year).toContain("next.js");
    expect(pages.year).toContain("/categories/language/typescript");
    expect(pages.year).not.toContain("/categories/ecosystem/react");
    expect(pages.month).toContain("/categories/language/typescript");
    expect(pages.month).not.toContain("/categories/ecosystem/react");
    expect(pages.week).toContain("/categories/language/typescript");
    expect(pages.week).not.toContain("/categories/ecosystem/react");
    expect(pages.repo).toContain("vercel/next.js");
    expect(pages.repo).toContain("/categories/language/typescript");
    expect(pages.repo).not.toContain("/categories/ecosystem/react");
    expect(pages.org).toContain("vercel");
    expect(pages.org).toContain("/categories/language/typescript");
    expect(pages.org).not.toContain("/categories/ecosystem/react");
  });

  test("Vercel ranking-detail / repo / org still read narrowed assignment shards", async () => {
    process.env.HOSTING_TARGET = "vercel";
    delete process.env.NEXT_PUBLIC_HOSTING_TARGET;
    delete process.env.VERCEL_ENV;
    const probe = installFetchProbe();
    await renderHeavyPages();
    const shardPaths = probe.paths.filter((path) => path.includes("assignments/shards/"));

    expect(probe.shardReads).toBeGreaterThan(0);
    expect(probe.paths).toContain("categories/assignments.json");
    expect(shardPaths).toContain("categories/assignments/shards/1.json");
    expect(probe.shardReads).toBeLessThan(32);
  });
});

async function renderHeavyPages(): Promise<{ year: string; month: string; week: string; repo: string; org: string }> {
  return {
    year: await renderPage(await RankingsYearPageView({ locale: "en", year: "2026", now: NOW })),
    month: await renderPage(await RankingsPeriodPageView({ locale: "en", year: "2026", period: "6" })),
    week: await renderPage(await RankingsPeriodPageView({ locale: "en", year: "2026", period: "W26" })),
    repo: await renderPage(await RepoPageView({ locale: "en", owner: "vercel", name: "next.js" })),
    org: await renderPage(await OrgPageView({ locale: "en", login: ORG_LOGIN })),
  };
}

function installFetchProbe(): { paths: string[]; shardReads: number } {
  const probe = { paths: [] as string[], shardReads: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const key = viewKey(input);
    probe.paths.push(key);
    if (key.includes("assignments/shards/")) probe.shardReads += 1;
    const body = fixtureForView(key);
    if (body === null) return new Response("not found", { status: 404 });
    return Response.json(body);
  }) as typeof fetch;
  return probe;
}

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function viewKey(input: RequestInfo | URL): string {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  let path = url.pathname.replace(/^\/+/, "");
  const versionPrefix = `views/${VERSION}/`;
  if (path.startsWith(versionPrefix)) path = path.slice(versionPrefix.length);
  return path;
}

function fixtureForView(path: string): unknown | null {
  if (path === "views/latest.json") return { version: VERSION, run_id: VERSION, published_at: GENERATED_AT, prev_version: null, schema_ver: 1 };
  if (path === "meta.json") {
    return {
      seam_date: "2026-06-01",
      schema_ver: 1,
      generated_at: GENERATED_AT,
      folded_through: { month: "2026-06", week: "2026-W26" },
    };
  }
  if (path === "lookup/repos.json") return reposLookupFixture;
  if (path === "lookup/aliases.json") return {};
  if (path === "categories/registry.json") return registryFixture;
  if (path === "categories/assignments.json") return index;
  if (path === `entity/repo/${REPO_ID}.json`) return repoEntityFixture;
  if (path === `entity/org/${ORG_LOGIN}.json`) return orgEntityFixture;
  if (path === "heatmap/year/2026.json") return heatmapFixture("year", "2026");
  if (path === "heatmap/month/2026-06.json") return heatmapFixture("month", "2026-06");
  const shard = shardByPath.get(path);
  if (shard) return shard;

  const liveRank = path.match(/^live\/rank\/(month|week)\/([^/]+)\/repo\/(flow|growth|new)\.json$/);
  if (liveRank) return null;
  if (path.startsWith("live/heatmap/")) return null;

  const rank = path.match(/^rank\/(year|month|week)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (rank) {
    const [, window, period, dim, metric] = rank;
    if (period === "2026-07" || period === "2026-W28" || period === "2026-W27") return null;
    if (period === "2026" || period === "2025" || period === "2026-06" || period === "2026-W26") {
      return rankFixture(window, period, dim, metric);
    }
  }

  return null;
}

function rankFixture(window: string, period: string, dim: string, metric: string): RankList {
  return {
    meta: {
      window: window as RankList["meta"]["window"],
      period: period as RankList["meta"]["period"],
      dim: dim as RankList["meta"]["dim"],
      metric: metric as RankList["meta"]["metric"],
      generated_at: GENERATED_AT,
    },
    items: [
      dim === "repo"
        ? { rank: 1, id: REPO_ID, value: metric === "stock" ? 100_000 : 100, prev_rank: null }
        : { rank: 1, login: ORG_LOGIN, value: 100_000, prev_rank: null },
    ],
  };
}

function heatmapFixture(scope: "year" | "month", period: string): Heatmap {
  return {
    meta: { scope, period, generated_at: GENERATED_AT },
    cells: scope === "year" ? [["2026-06", 100]] : [["2026-06-01", 10]],
  };
}

const reposLookupFixture: ReposLookup = {
  [String(REPO_ID)]: {
    owner: "vercel",
    name: "next.js",
    full_name: "vercel/next.js",
    owner_type: "Organization",
    language: "TypeScript",
    current_stars: 100_000,
  },
};

const registryFixture: CategoryRegistry = {
  rules_version: "test",
  generated_at: GENERATED_AT,
  dimensions: [
    {
      id: "language",
      label: "Language",
      categories: [
        {
          id: "language/typescript",
          dimension: "language",
          slug: "typescript",
          label: "TypeScript",
          count: 1,
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
          id: "ecosystem/react",
          dimension: "ecosystem",
          slug: "react",
          label: "React",
          count: 1,
          public: true,
          sitemap: true,
          minimum_repo_count: 1,
        },
      ],
    },
  ],
};

const repoEntityFixture: RepoEntity = {
  id: REPO_ID,
  full_name: "vercel/next.js",
  owner: "vercel",
  owner_type: "Organization",
  name: "next.js",
  description: "The React Framework",
  language: "TypeScript",
  languages: [{ name: "TypeScript", size: 1000, color: "#3178c6" }],
  topics: ["nextjs"],
  homepage_url: null,
  license: "MIT",
  latest_release: null,
  created_at: "2016-10-25",
  current_stars: 100_000,
  is_archived: false,
  milestones: { crossed_10k: "2017-01-01", crossed_50k: "2018-01-01", crossed_100k: "2020-01-01" },
  curve: {
    monthly: [
      ["2020-01", 2_000, 100_000],
      ["2026-06", 400, 100_000],
    ],
    recent_daily: [["2026-06-04", 12]],
  },
  monthly_table: [{ month: "2026-06", adds: 400, rank: 1 }],
  rank_history: { month: [["2026-06", 1]] },
  inflections: [],
};

const orgEntityFixture: OrgEntity = {
  login: ORG_LOGIN,
  owner_type: "Organization",
  current_stars_sum: 100_000,
  repo_count: 1,
  members: [REPO_ID],
  curve: {
    monthly: [
      ["2024-01", 1_000, 90_000],
      ["2026-06", 400, 100_000],
    ],
    recent_daily: [["2026-06-04", 12]],
  },
  rank_history: { month: [["2026-06", 1]] },
};
