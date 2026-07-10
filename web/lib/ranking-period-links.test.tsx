import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { HotSnapshot, OrgsLookup, RankList, ReposLookup } from "@/lib/contracts";

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

const { RankingsYearPageView } = await import("@/app/_localized/ranking-detail");
const { RankingsPageView } = await import("@/app/_localized/rankings");
const { getRank } = await import("@/lib/data/rank");

const BLOB_BASE_URL = "https://ranking-period-links.test";
const VERSION = "ranking-period-links";
const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-07-08T12:00:00.000Z");
const REPO_ID = 1;
const ORG_LOGIN = "vercel";

beforeAll(() => {
  process.env.BLOB_BASE_URL = BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  globalThis.fetch = fixtureFetch as typeof fetch;
});

describe("ranking period internal links", () => {
  test("rankings surfaces do not render links to missing month or week rank views", async () => {
    const pages = await Promise.all([
      renderPage(await RankingsPageView({ locale: "en", now: NOW })),
      renderPage(await RankingsYearPageView({ locale: "en", year: "2026", now: NOW })),
    ]);
    const anchors = [...new Set(pages.flatMap(extractAnchors))];
    const periodAnchors = anchors.filter((href) => /^\/rankings\/\d{4}\/(?:\d{1,2}|W\d{2})$/.test(href));

    expect(anchors).not.toContain("/rankings/2026/7");
    expect(anchors).not.toContain("/rankings/2026/W28");
    expect(anchors).toContain("/rankings/2026/6");
    expect(anchors).toContain("/rankings/2026/W26");

    const missing: string[] = [];
    for (const href of periodAnchors) {
      const rank = await rankForHref(href);
      if (!rank) missing.push(href);
    }

    expect(missing).toEqual([]);
  });
});

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

async function rankForHref(href: string): Promise<RankList | null> {
  const match = /^\/rankings\/(\d{4})\/(?:(\d{1,2})|W(\d{2}))$/.exec(href);
  if (!match) throw new Error(`not a ranking period href: ${href}`);
  const [, year, month, week] = match;
  if (month) return getRank("month", `${year}-${month.padStart(2, "0")}`, "repo", "flow");
  return getRank("week", `${year}-W${week}`, "repo", "flow");
}

function extractAnchors(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeHtml(match[1]));
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

async function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
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
  if (path === "views/latest.json") return { version: VERSION, run_id: VERSION, published_at: GENERATED_AT, prev_version: null, schema_ver: 1 };
  if (path === "meta.json") {
    return {
      seam_date: "2026-06-01",
      schema_ver: 1,
      generated_at: GENERATED_AT,
      folded_through: { month: "2026-06", week: "2026-W26" },
    };
  }
  if (path === "hot-snapshot.json") return hotSnapshotFixture;
  if (path === "lookup/repos.json") return reposLookupFixture;
  if (path === "lookup/orgs.json") return orgsLookupFixture;
  if (path === "rank/all-time/repo/stock.json") return rankFixture("all", "all", "repo", "stock");
  if (path === "rank/all-time/org/stock.json") return rankFixture("all", "all", "org", "stock");
  if (path === "heatmap/year/2026.json") return { meta: { scope: "year", period: "2026", generated_at: GENERATED_AT }, cells: [["2026-06", 100]] };

  const liveRank = path.match(/^live\/rank\/(month|week)\/([^/]+)\/repo\/flow\.json$/);
  if (liveRank) return null;

  const rank = path.match(/^rank\/(year|month|week)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (rank) {
    const [, window, period, dim, metric] = rank;
    if (period === "2026-07" || period === "2026-W28" || period === "2026-W27") return null;
    if (period === "2026" || period === "2025" || period === "2026-06" || period === "2026-W26") return rankFixture(window, period, dim, metric);
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

const orgsLookupFixture: OrgsLookup = {
  [ORG_LOGIN]: {
    login: ORG_LOGIN,
    owner_type: "Organization",
    repo_count: 1,
    current_stars_sum: 100_000,
  },
};

const hotSnapshotFixture: HotSnapshot = {
  generated_at: GENERATED_AT,
  home: {
    year_spine: [["2026", 100]],
    current_month_top: {
      flow: [{ rank: 1, id: REPO_ID, value: 100, prev_rank: null }],
      stock: [{ rank: 1, id: REPO_ID, value: 100_000, prev_rank: null }],
    },
    on_this_day: [],
  },
  current_year: {
    flow: [{ rank: 1, id: REPO_ID, value: 100, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 100_000, prev_rank: null }],
  },
  current_month: {
    flow: [{ rank: 1, id: REPO_ID, value: 100, prev_rank: null }],
    stock: [{ rank: 1, id: REPO_ID, value: 100_000, prev_rank: null }],
  },
  all_time: {
    repo: [{ rank: 1, id: REPO_ID, value: 100_000, prev_rank: null }],
    org: [{ rank: 1, login: ORG_LOGIN, value: 100_000, prev_rank: null }],
  },
};
