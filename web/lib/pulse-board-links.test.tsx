import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { HotSnapshot, OrgsLookup, RankList, ReposLookup } from "@/lib/contracts";
import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import { localizedPulseBoardHrefs, pulseBoardHrefs } from "./pulse-board-links";

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

const { PulsePageView } = await import("@/app/_localized/pulse");

const BLOB_BASE_URL = "https://pulse-board-links.test";
const VERSION = "pulse-board-links";
const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-07-08T12:00:00.000Z");
const REPO_ID = 1;
const originalFetch = globalThis.fetch;
const originalBlobBase = process.env.BLOB_BASE_URL;
const originalPublicBlobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

const availablePeriods: AvailableRankPeriods = {
  year: 2026,
  yearLink: { kind: "year", year: 2026, href: "/rankings/2026", label: "2026", asOf: GENERATED_AT },
  month: {
    kind: "month",
    year: 2026,
    month: 6,
    period: "2026-06",
    href: "/rankings/2026/6",
    label: "June 2026",
    asOf: GENERATED_AT,
  },
  week: {
    kind: "week",
    year: 2026,
    week: 26,
    period: "2026-W26",
    href: "/rankings/2026/W26",
    label: "2026-W26",
    asOf: GENERATED_AT,
  },
  allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
};

beforeAll(() => {
  process.env.BLOB_BASE_URL = BLOB_BASE_URL;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  globalThis.fetch = fixtureFetch as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  if (originalBlobBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBlobBase;
  if (originalPublicBlobBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBlobBase;
});

describe("pulseBoardHrefs", () => {
  test("maps each pulse panel to the already-resolved ranking route", () => {
    expect(pulseBoardHrefs(availablePeriods)).toEqual({
      week: "/rankings/2026/W26",
      month: "/rankings/2026/6",
      year: "/rankings/2026",
      allTime: "/rankings",
    });
  });

  test("follows fallback week/month/year hrefs instead of inventing a missing period", () => {
    expect(
      pulseBoardHrefs({
        week: { kind: "fallback", href: "/rankings", label: "Full history" },
        month: { kind: "year", year: 2025, href: "/rankings/2025", label: "2025" },
        yearLink: { kind: "fallback", href: "/rankings", label: "Full history" },
        allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
      }),
    ).toEqual({
      week: "/rankings",
      month: "/rankings/2025",
      year: "/rankings",
      allTime: "/rankings",
    });
  });
});

describe("localizedPulseBoardHrefs", () => {
  test("leaves English unprefixed and prefixes other locales", () => {
    expect(localizedPulseBoardHrefs("en", availablePeriods).week).toBe("/rankings/2026/W26");
    expect(localizedPulseBoardHrefs("ja", availablePeriods)).toEqual({
      week: "/ja/rankings/2026/W26",
      month: "/ja/rankings/2026/6",
      year: "/ja/rankings/2026",
      allTime: "/ja/rankings",
    });
    expect(localizedPulseBoardHrefs("zh", availablePeriods).month).toBe("/zh/rankings/2026/6");
  });
});

describe("PulsePageView board exits", () => {
  test("week, month, year, and all-time panels open the matching ranking board", async () => {
    const html = await renderPage(await PulsePageView({ locale: "en", canonicalPath: "/pulse", now: NOW }));
    const boards = extractBoardHrefs(html, "Full board");

    expect(boards).toContain("/rankings/2026/W26");
    expect(boards).toContain("/rankings/2026/6");
    expect(boards).toContain("/rankings/2026");
    expect(boards).toContain("/rankings");
    expect(boards).not.toContain("/rankings/2026/7");
    expect(boards).not.toContain("/rankings/2026/W28");
    expect(extractHrefs(html)).toContain("/vercel/next.js");
  });

  test("locale prefixes apply to full-board and repo-hub links", async () => {
    const html = await renderPage(await PulsePageView({ locale: "ja", canonicalPath: "/pulse", now: NOW }));
    const boards = extractBoardHrefs(html, "全順位");

    expect(boards).toContain("/ja/rankings/2026/W26");
    expect(boards).toContain("/ja/rankings/2026/6");
    expect(boards).toContain("/ja/rankings/2026");
    expect(boards).toContain("/ja/rankings");
    expect(extractHrefs(html)).toContain("/ja/vercel/next.js");
  });
});

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

function extractHrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeHtml(match[1]));
}

function extractBoardHrefs(html: string, label: string): string[] {
  const hrefs: string[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = match[1];
    const aria = /aria-label=["']([^"']+)["']/i.exec(attrs)?.[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && aria && decodeHtml(aria).includes(label)) hrefs.push(decodeHtml(href));
  }
  return [...new Set(hrefs)];
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
  const body = fixtureForView(viewKey(input));
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

  const liveRank = path.match(/^live\/rank\/(month|week)\/([^/]+)\/repo\/flow\.json$/);
  if (liveRank) return null;

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
        : { rank: 1, login: "vercel", value: 100_000, prev_rank: null },
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
  vercel: {
    login: "vercel",
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
    org: [],
  },
};
