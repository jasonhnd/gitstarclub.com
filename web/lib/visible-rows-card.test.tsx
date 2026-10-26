import { createRankFixture } from "@/lib/integration/fixtures/rank";
import { viewKey } from "@/lib/integration/fixtures/view-key";
import { decodeHtml } from "@/lib/integration/fixtures/html";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { HotSnapshot, OrgsLookup, ReposLookup } from "@/lib/contracts";
import { getDictionary } from "@/lib/i18n";

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

const { RankingsPeriodPageView } = await import("@/app/_localized/ranking-detail");

const BLOB_BASE_URL = "https://visible-rows-card.test";
const VERSION = "visible-rows-card";
const GENERATED_AT = "2026-07-21T00:00:00.000Z";
const ROW_COUNTS: Record<string, number> = { "2026-05": 0, "2026-06": 1, "2026-07": 2 };
const PERIODS = [
  { period: "5", key: "2026-05" },
  { period: "6", key: "2026-06" },
  { period: "7", key: "2026-07" },
] as const;

const rankFixture = createRankFixture({
  generatedAt: GENERATED_AT,
  repoId: 1,
  orgLogin: "vercel",
  stock: 100_000,
  flow: 100,
  orgValue: 100_000,
});

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

describe("ranking stats card visible rows", () => {
  test("renders singular and plural counts for 0, 1, and 2 rows in en, es, and fr", async () => {
    const expected = {
      en: ["0 repositories", "1 repository", "2 repositories"],
      es: ["0 repositorios", "1 repositorio", "2 repositorios"],
      fr: ["0 dépôt", "1 dépôt", "2 dépôts"],
    } as const;

    for (const locale of ["en", "es", "fr"] as const) {
      const dictionary = await getDictionary(locale);
      for (const [index, entry] of PERIODS.entries()) {
        const html = decodeHtml(await renderPage(await RankingsPeriodPageView({ locale, year: "2026", period: entry.period })));
        expect(statValue(html, dictionary.rankings.visibleRows), `${locale} ${entry.key}`).toBe(expected[locale][index]);
      }
    }
  });
});

function statValue(html: string, label: string): string {
  const match = new RegExp(`<dt[^>]*>${label}</dt>\\s*<dd[^>]*>([^<]*)</dd>`).exec(html);
  if (!match?.[1]) throw new Error(`missing stats value for ${label}`);
  return match[1].trim();
}

async function renderPage(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

async function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const key = viewKey(input, VERSION);
  const body = fixtureForView(key);
  if (body === null) return new Response("not found", { status: 404 });
  return Response.json(body);
}

function fixtureForView(path: string): unknown | null {
  if (path === "views/latest.json") return { version: VERSION, run_id: VERSION, published_at: GENERATED_AT, prev_version: null, schema_ver: 1 };
  if (path === "meta.json") {
    return { seam_date: "2026-06-01", schema_ver: 1, generated_at: GENERATED_AT, folded_through: { month: "2026-07", week: "2026-W28" } };
  }
  if (path === "hot-snapshot.json") return hotSnapshotFixture;
  if (path === "lookup/repos.json") return reposLookupFixture;
  if (path === "lookup/orgs.json") return orgsLookupFixture;

  const rank = path.match(/^rank\/(year|month|week)\/([^/]+)\/(repo|org)\/(flow|stock|growth|new)\.json$/);
  if (!rank) return null;
  const [, window, period, dim, metric] = rank;
  if (window === "year" && period === "2026") return rankWithCount(window, period, dim, metric, 1);
  const count = ROW_COUNTS[period];
  if (window !== "month" || count == null) return null;
  return rankWithCount(window, period, dim, metric, dim === "repo" ? count : 1);
}

function rankWithCount(window: string, period: string, dim: string, metric: string, count: number) {
  const list = rankFixture(window, period, dim, metric);
  if (dim !== "repo") return list;
  return {
    ...list,
    items: Array.from({ length: count }, (_, index) => ({
      rank: index + 1,
      id: index + 1,
      value: metric === "stock" ? 100_000 : 100,
      prev_rank: null,
    })),
  };
}

const reposLookupFixture: ReposLookup = {
  "1": { owner: "vercel", name: "next.js", full_name: "vercel/next.js", owner_type: "Organization", language: "TypeScript", current_stars: 100_000 },
  "2": { owner: "vuejs", name: "vue", full_name: "vuejs/vue", owner_type: "Organization", language: "TypeScript", current_stars: 90_000 },
};

const orgsLookupFixture: OrgsLookup = {
  vercel: { login: "vercel", owner_type: "Organization", repo_count: 1, current_stars_sum: 100_000 },
};

const hotSnapshotFixture: HotSnapshot = {
  generated_at: GENERATED_AT,
  home: { year_spine: [["2026", 100]], current_month_top: { flow: [], stock: [] }, on_this_day: [] },
  current_year: { flow: [], stock: [] },
  current_month: { flow: [], stock: [] },
  all_time: { repo: [], org: [] },
};
