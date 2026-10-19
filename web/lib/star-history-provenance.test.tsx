import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import type { ReactElement } from "react";
import { PROVENANCE } from "../../pipeline/scripts/star-history-aggregate.mjs";
import { Curve, RankList, StarHistoryProvenance } from "@/lib/contracts";
import { aggregateDailyPoints, hasAggregateWeek } from "@/lib/star-history-provenance";
import { normalizeRepoPageEntity } from "@/lib/repo-readiness";
import { getDictionary, LOCALES } from "@/lib/i18n";
import { RepoDailyHistorySection } from "@/app/_localized/repo-sections";

mock.module("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  permanentRedirect: (location: string) => { throw new Error(`NEXT_REDIRECT:${location}`); },
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, prefetch() {} }),
}));

const provenance = StarHistoryProvenance.parse(PROVENANCE);
const entry = { owner: "example", name: "history", full_name: "example/history", owner_type: "Organization", language: "TypeScript", current_stars: 24000 };
const monthly: Array<[string, number, number]> = [["2026-08", 1500, 23000], ["2026-09", 1000, 24000]];
const days: Array<[string, number]> = [["2026-05-29", 9], ["2026-05-30", 0], ["2026-06-01", 12], ["2026-09-30", 4], ["2026-10-01", 3]];
const repo = { id: 42, ...entry, topics: [], created_at: "2020-01-01", is_archived: false,
  milestones: { crossed_10k: null, crossed_50k: null, crossed_100k: null },
  curve: { monthly, recent_daily: days, provenance }, monthly_table: [], rank_history: {} };

let marked = true;
const savedFetch = globalThis.fetch;
const savedEnv = { BLOB_BASE_URL: process.env.BLOB_BASE_URL, NEXT_PUBLIC_BLOB_BASE_URL: process.env.NEXT_PUBLIC_BLOB_BASE_URL };
beforeAll(() => {
  process.env.BLOB_BASE_URL = "https://star-history-label.test";
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const key = url.pathname.slice(1);
    const flag = marked ? { provenance } : {};
    let body: unknown = null;
    if (key === "meta.json") body = { seam_date: "2026-05-30", schema_ver: 1, generated_at: "2026-10-20T00:00:00.000Z", folded_through: { month: "2026-09", week: "2026-W39" } };
    if (key === "lookup/repos.json") body = { "42": entry };
    if (key === "lookup/aliases.json") body = {};
    if (key === "entity/repo/42.json") body = { ...repo, curve: { monthly, recent_daily: days, ...flag } };
    if (key === "entity/org/example.json") body = { login: "example", owner_type: "Organization", current_stars_sum: 24000, repo_count: 1, members: [42], curve: { monthly, recent_daily: days, ...flag } };
    const rank = /^rank\/(year|month|week)\/([^/]+)\/repo\/(flow|growth|new)\.json$/.exec(key);
    if (rank) {
      const [, window, period, metric] = rank;
      body = { meta: { window, period, metric, dim: "repo", generated_at: "2026-10-20T00:00:00.000Z", ...flag },
        items: metric === "flow" ? [{ rank: 1, id: 42, value: 1000, prev_rank: null }] : [] };
    }
    return body === null ? new Response("absent", { status: 404 }) : Response.json(body);
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  mock.restore();
});

const { RankingsPeriodPageView } = await import("@/app/_localized/ranking-detail");
const { RepoPageView } = await import("@/app/_localized/repo");
const { OrgPageView } = await import("@/app/_localized/org");
const { PulsePageView } = await import("@/app/_localized/pulse");

async function html(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}
function text(markup: string) {
  return markup.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
}

describe("aggregate provenance contract and approved boundaries", () => {
  test("a measured zero remains a labeled daily observation with an accurate accessible count", async () => {
    const t = await getDictionary("en");
    const markup = await html(<RepoDailyHistorySection points={[["2026-05-30", 0]]} provenance={provenance} locale="en" t={t} />);
    expect(markup).toContain("up to 0 stars per day across 1 recorded days");
    expect(markup).toContain(t.common.starHistoryNote);
  });
  test("accepts the collector's exact sidecar and retains it through strict and tolerant reads", () => {
    expect(Curve.parse(repo.curve).provenance).toEqual(provenance);
    expect(normalizeRepoPageEntity(repo)?.curve.provenance).toEqual(provenance);
    expect(normalizeRepoPageEntity(repo)?.curve.monthly).toEqual(monthly);
    expect(normalizeRepoPageEntity({ ...repo, curve: { ...repo.curve, provenance: { ...provenance, metric: "net" } } })?.curve.provenance).toBeUndefined();
    expect(StarHistoryProvenance.safeParse({ ...PROVENANCE, end_inclusive: "2026-10-01" }).success).toBe(false);
    expect(RankList.parse({ meta: { window: "week", period: "2026-W39", metric: "flow", dim: "repo", generated_at: "2026-10-01T00:00:00.000Z", provenance }, items: [] }).meta.provenance).toEqual(provenance);
  });
  test("uses actual marked dates, retains measured zero, and excludes missing/outside/invalid dates", () => {
    expect(aggregateDailyPoints(days, provenance)).toEqual([["2026-05-30", 0], ["2026-06-01", 12], ["2026-09-30", 4]]);
    expect(aggregateDailyPoints(days, undefined)).toEqual([]);
    expect(aggregateDailyPoints([], provenance)).toEqual([]);
    expect(aggregateDailyPoints([["2026-06-31", 4]], provenance)).toEqual([]);
  });
  test("covers both partial ISO-week edges and rejects adjacent weeks and monthly/yearly totals", () => {
    for (const week of [22, 23, 39, 40]) expect(hasAggregateWeek("week", `2026-W${week}`, provenance)).toBe(true);
    for (const period of ["2026-W21", "2026-W41", "2025-W40", "2026-W53", "2026-06", "bad"]) expect(hasAggregateWeek("week", period, provenance)).toBe(false);
    for (const window of ["month", "year", "all"]) expect(hasAggregateWeek(window, "2026-W39", provenance)).toBe(false);
    expect(hasAggregateWeek("week", "2026-W39", undefined)).toBe(false);
    expect(hasAggregateWeek("week", "2026-W39", { ...provenance, day_shift: 1 })).toBe(false);
  });
});

for (const locale of LOCALES) {
  test(`${locale}: renders the daily curve, weekly ranking and other daily/weekly surfaces; never labels monthly totals`, async () => {
    marked = true;
    const t = await getDictionary(locale);
    expect(t.common.starHistoryNote).toContain("GitHub");
    expect(t.common.starHistoryNote).toContain("UTC");
    expect(t.common.starHistoryNote).not.toMatch(/\b(?:Blob|JSON|R2|servers?|APIs?)\b/i);
    const daily = text(await html(<RepoDailyHistorySection points={days} provenance={provenance} locale={locale} t={t} />));
    expect(daily).toContain(t.common.starHistoryNote);
    expect(daily).toContain("2026-05-30");
    expect(daily).not.toContain("2026-05-29");
    expect(daily).not.toContain("2026-10-01");
    expect(daily).not.toMatch(/\{stars\}|\{points\}|<script/);
    expect(text(await html(await RepoPageView({ locale, owner: "example", name: "history" })))).toContain(t.common.starHistoryNote);
    expect(text(await html(await OrgPageView({ locale, login: "example" })))).toContain(t.common.starHistoryNote);
    expect(text(await html(await PulsePageView({ locale, canonicalPath: "/pulse", now: new Date("2026-06-04T00:00:00Z") })))).toContain(t.common.starHistoryNote);
    for (const period of ["W22", "W39", "W40"]) {
      expect(text(await html(await RankingsPeriodPageView({ locale, year: "2026", period })))).toContain(t.common.starHistoryNote);
    }
    for (const period of ["W21", "W41", "9"]) {
      expect(text(await html(await RankingsPeriodPageView({ locale, year: "2026", period })))).not.toContain(t.common.starHistoryNote);
    }
    expect(await html(<RepoDailyHistorySection points={[["2026-10-01", 1]]} provenance={provenance} locale={locale} t={t} />)).toBe("");
    marked = false;
    expect(text(await html(await PulsePageView({ locale, canonicalPath: "/pulse", now: new Date("2026-06-04T00:00:00Z") })))).not.toContain(t.common.starHistoryNote);
    expect(text(await html(await OrgPageView({ locale, login: "example" })))).not.toContain(t.common.starHistoryNote);
    expect(text(await html(await RankingsPeriodPageView({ locale, year: "2026", period: "W39" })))).not.toContain(t.common.starHistoryNote);
    expect(text(await html(await RepoPageView({ locale, owner: "example", name: "history" })))).not.toContain(t.common.starHistoryNote);
    expect(await html(<RepoDailyHistorySection points={days} provenance={undefined} locale={locale} t={t} />)).toBe("");
  });
}
