import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { buildArchiveItems } from "@/app/_localized/rankings";
import { ARCHIVE_CHILD_PROBE_LIMIT_CF, loadArchiveChildPeriods } from "@/app/_localized/ranking-page-data";
import type { HotSnapshot, OrgsLookup, RankList, ReposLookup } from "@/lib/contracts";
import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import { invalidatePublishedVersionMemo } from "@/lib/data/source";
import { runWithCloudflareWorkersHostForTests } from "@/lib/runtime-config";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import en from "@/lib/i18n/dictionaries/en";
import ja from "@/lib/i18n/dictionaries/ja";

const publishedRank: RankList = {
  meta: { window: "month", period: "2025-12", dim: "repo", metric: "flow", generated_at: "2026-06-21T00:00:00.000Z" },
  items: [],
};

describe("rankings archive items", () => {
  test("lists every tracked year and retains only published historical children", async () => {
    const calls: string[] = [];
    const items = await buildArchiveItems([["2024", 1_000], ["2026", 3_000], ["2025", 2_000]], availablePeriodsFixture(), "en", en, {
      readRank: async (window, period) => {
        calls.push(`${window}/${period}`);
        return period === "2025-12" ? publishedRank : null;
      },
    });
    expect(items.map((item) => item.href)).toEqual(["/rankings/2026", "/rankings/2025", "/rankings/2024"]);
    expect(items[0].childrenLinks?.map((link) => link.href)).toEqual(["/rankings/2026", "/rankings/2026/7", "/rankings/2026/W27"]);
    expect(items[1].childrenLinks?.map((link) => link.href)).toEqual(["/rankings/2025", "/rankings/2025/12"]);
    expect(items[2].childrenLinks?.map((link) => link.href)).toEqual(["/rankings/2024"]);
    expect(calls).toEqual(["month/2025-12", "week/2025-W52", "month/2024-12", "week/2024-W52"]);
  });

  test("sparse recovered years never link absent December or final-week data", async () => {
    const items = await buildArchiveItems([["2020", 9_000], ["2025", 1_000]], availablePeriodsFixture(), "en", en, {
      readRank: async (_window, period) => ["2020-09", "2020-W51", "2025-03", "2025-W12"].includes(period) ? publishedRank : null,
    });
    expect(items.flatMap((item) => item.childrenLinks ?? []).map((link) => link.href)).toEqual(["/rankings/2025", "/rankings/2020"]);
  });

  test("a published empty final ISO week remains available in a 53-week year", async () => {
    const calls: string[] = [];
    const [item] = await buildArchiveItems([["2020", 0]], availablePeriodsFixture(), "en", en, {
      readRank: async (_window, period) => {
        calls.push(period);
        return period === "2020-W53" ? publishedRank : null;
      },
    });
    expect(calls).toEqual(["2020-12", "2020-W53"]);
    expect(item.childrenLinks).toEqual([{ label: en.year.label, href: "/rankings/2020" }, { label: en.rankings.archiveWeeks, href: "/rankings/2020/W53", count: 53 }]);
  });

  test("current resolved children need no additional probes", async () => {
    const children = await loadArchiveChildPeriods([2026], availablePeriodsFixture(), {
      readRank: async () => { throw new Error("resolved children must not be re-probed"); },
    });
    expect(children.get(2026)).toEqual({ month: 7, week: 27 });
  });

  test("uses independent resolver years and does not infer children for fallback periods", async () => {
    const periods: AvailableRankPeriods = {
      ...availablePeriodsFixture(),
      month: { kind: "month", year: 2025, month: 6, period: "2025-06", href: "/rankings/2025/6", label: "June 2025" },
      week: { kind: "year", year: 2024, href: "/rankings/2024", label: "2024" },
    };
    const calls: string[] = [];
    const items = await buildArchiveItems([["2024", 0], ["2025", 0], ["2026", 0]], periods, "en", en, {
      readRank: async (_window, period) => { calls.push(period); return null; },
    });
    expect(calls).toEqual(["2024-12"]);
    expect(items.map((item) => item.childrenLinks?.map((link) => link.href))).toEqual([["/rankings/2026"], ["/rankings/2025", "/rankings/2025/6"], ["/rankings/2024"]]);
  });

  test("Cloudflare bounds probes and omits unverified children from older years", async () => {
    await runWithCloudflareWorkersHostForTests(true, async () => {
      const calls: string[] = [];
      const items = await buildArchiveItems([["2022", 1], ["2026", 1], ["2025", 1], ["2023", 1], ["2024", 1]], availablePeriodsFixture(), "en", en, {
        readRank: async (_window, period) => { calls.push(period); return publishedRank; },
      });
      expect(calls).toHaveLength(ARCHIVE_CHILD_PROBE_LIMIT_CF);
      expect(calls).toEqual(["2025-12", "2025-W52", "2024-12", "2024-W52"]);
      expect(items[1].childrenLinks).toHaveLength(3);
      expect(items[2].childrenLinks).toHaveLength(3);
      expect(items[3].childrenLinks).toHaveLength(1);
      expect(items[4].childrenLinks).toHaveLength(1);
    });
  });

  test("deduplicates years, preserves zero totals, and ignores malformed/negative spine entries", async () => {
    const calls: string[] = [];
    const items = await buildArchiveItems([["invalid", 1], ["2025", 0], ["2025", 100], ["2024", -1], ["2026", 0]], availablePeriodsFixture(), "en", en, {
      readRank: async (_window, period) => { calls.push(period); return null; },
    });
    expect(items.map((item) => item.label)).toEqual(["2026", "2025"]);
    expect(calls).toEqual(["2025-12", "2025-W52"]);
    expect(items[0].count).toContain("0");
  });

  test("does not reinterpret a probe failure as confirmed publication", async () => {
    await expect(buildArchiveItems([["2025", 0]], availablePeriodsFixture(), "en", en, {
      readRank: async () => { throw new Error("fixture transport failure"); },
    })).rejects.toThrow("fixture transport failure");
  });

  test("localizes archive chrome and compact totals", async () => {
    const [item] = await buildArchiveItems([["2026", 12_300]], availablePeriodsFixture(), "ja", ja);
    expect(item.description).toBe("年別アーカイブ");
    expect(item.count).toBe("1.2万 スター獲得");
    expect(item.childrenLinks?.map((link) => link.label)).toEqual(["年", "月", "週"]);
  });

  test.each(["en", "ja", "zh", "zh-TW", "ko", "es", "fr"] as Locale[])("%s keeps locale labels on verified historical links", async (locale) => {
    const t = await getDictionary(locale);
    const [item] = await buildArchiveItems([["2025", 12_300]], availablePeriodsFixture(), locale, t, { readRank: async () => publishedRank });
    expect(item.description).toBe(t.rankings.archiveDescription);
    expect(item.childrenLinks?.map((link) => link.label)).toEqual([t.year.label, t.rankings.archiveMonths, t.rankings.archiveWeeks]);
    expect(item.childrenLinks?.map((link) => link.count)).toEqual([undefined, 12, 52]);
  });
});

function availablePeriodsFixture() {
  return {
    year: 2026,
    yearLink: { kind: "year", year: 2026, href: "/rankings/2026", label: "2026" },
    month: { kind: "month", year: 2026, month: 7, period: "2026-07", href: "/rankings/2026/7", label: "July 2026" },
    week: { kind: "week", year: 2026, week: 27, period: "2026-W27", href: "/rankings/2026/W27", label: "2026-W27" },
    allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
  } as const;
}

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


const { RankingsPageView } = await import("@/app/_localized/rankings");
const { getRank } = await import("@/lib/data/rank");
const fetchCalls: string[] = [];
const BLOB_BASE_URL = "https://rankings-archive.test";
const VERSION = "rankings-archive";
const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-07-08T12:00:00.000Z");
const REPO_ID = 1;
const ORG_LOGIN = "vercel";
const originalFetch = globalThis.fetch;
const originalBlobBase = process.env.BLOB_BASE_URL;
const originalPublicBlobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

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

describe("archive page caller boundary", () => {
  test.each(["en", "ja"] as Locale[])("%s omits missing historic children from rendered HTML", async (locale) => {
    const html = await renderPage(await RankingsPageView({ locale, now: NOW }));
    const prefix = locale === "en" ? "" : `/${locale}`;
    const anchors = extractAnchors(html);
    expect(anchors).toContain(`${prefix}/rankings/2025`);
    expect(anchors).toContain(`${prefix}/rankings/2020`);
    expect(anchors).not.toContain(`${prefix}/rankings/2025/12`);
    expect(anchors).not.toContain(`${prefix}/rankings/2025/W52`);
    expect(anchors).not.toContain(`${prefix}/rankings/2020/12`);
    expect(anchors).not.toContain(`${prefix}/rankings/2020/W53`);
    const childPaths = anchors.map((href) => href.slice(prefix.length)).filter((href) => /^\/rankings\/\d{4}\/(?:\d{1,2}|W\d{2})$/.test(href));
    expect(childPaths).toContain("/rankings/2026/6");
    expect(childPaths).toContain("/rankings/2026/W26");
    for (const href of new Set(childPaths)) expect(await rankForHref(href)).not.toBeNull();
  });

  test("the real Cloudflare archive caller stays below 50 fixture requests", async () => {
    await runWithCloudflareWorkersHostForTests(true, async () => {
      invalidatePublishedVersionMemo();
      fetchCalls.length = 0;
      await renderPage(await RankingsPageView({ locale: "en", now: NOW }));
      const childBaseReads = fetchCalls.filter((path) => /^rank\/(month|week)\/(2025|2020)-/.test(path));
      expect(childBaseReads).toHaveLength(4);
      expect(fetchCalls.length).toBeLessThan(50);
      expect(fetchCalls.some((path) => path.includes("assignments"))).toBe(false);
    });
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
  fetchCalls.push(key);
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
    if (period === "2026" || period === "2025" || period === "2020" || period === "2026-06" || period === "2026-W26" || period === "2020-09" || period === "2020-W51") return rankFixture(window, period, dim, metric);
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
    year_spine: [["2026", 100], ["2025", 1_000], ["2020", 9_000]],
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
