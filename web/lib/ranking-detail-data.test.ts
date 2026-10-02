import { describe, expect, test } from "bun:test";
import {
  loadRankingDetailData, projectRepoRows, projectGrowthRows, projectNewcomerRows, rankingDetailStructuredData,
  PULSE_MOVER_LIMIT, PULSE_GIANT_LIMIT, PULSE_ANNIVERSARY_LIMIT,
  RANKING_DETAIL_ROW_LIMIT, PRIMARY_PANEL_LIMIT, SECONDARY_PANEL_LIMIT, RANKING_FEATURED_LIMIT,
} from "@/app/_localized/ranking-page-data";
import { periodSwitcherLinks } from "@/app/_localized/ranking-ui";
import type { RankList, RankItem, ReposLookup, Heatmap, CategoryRegistry } from "@/lib/contracts";
import type { Locale } from "@/lib/i18n";
import { getDictionary } from "@/lib/i18n";
import { dateLabel } from "@/lib/format";
import { currentUtcPeriods } from "@/lib/periods";
import { localizedPath } from "@/lib/i18n/routing";
import { availablePeriodLabel } from "@/lib/rank-period-labels";
import { runWithCloudflareWorkersHostForTests } from "@/lib/runtime-config";

const GENERATED_AT = "2026-06-21T00:00:00.000Z";
const LOOKUP: ReposLookup = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [String(i + 1), {
  owner: "fixture", name: `repo-${i + 1}`, full_name: `fixture/repo-${i + 1}`, owner_type: "Organization", language: "TypeScript", current_stars: 100_000 + i,
}]));
const ITEMS: RankItem[] = Array.from({ length: 130 }, (_, i) => ({ rank: i + 1, id: i + 1, value: 130 - i, prev_rank: null, rate: i === 0 ? 0 : 5.25, date: "2026-06-01" }));

function rank(window: "year" | "month" | "week", period: string, metric: "flow" | "growth" | "new", items = ITEMS): RankList {
  return { meta: { window, period, dim: "repo", metric, generated_at: GENERATED_AT }, items };
}

function readers({ missingFlow = false, missingLookup = false, sparseLookup = false } = {}) {
  const calls: string[] = [];
  const assignmentIds: number[][] = [];
  const lookup = { ...LOOKUP };
  if (sparseLookup) delete lookup["1"];
  return {
    calls, assignmentIds,
    options: {
      readRank: async (window: "all" | "year" | "month" | "week", period: string, _dim: "repo" | "org", metric: "flow" | "stock" | "growth" | "new") => {
        calls.push(`${window}/${period}/${metric}`);
        if (metric === "flow" && missingFlow) return null;
        const view = rank(window as "year" | "month" | "week", period, metric as "flow" | "growth" | "new");
        if (metric === "growth") view.meta.generated_at = "2026-06-23T00:00:00.000Z";
        if (metric === "new") view.meta.generated_at = "2026-06-24T00:00:00.000Z";
        return view;
      },
      readLookup: async () => { calls.push("lookup"); return missingLookup ? null : lookup; },
      readRegistry: async () => { calls.push("registry"); return null; },
      readHeatmap: async (scope: "year" | "month", period: string): Promise<Heatmap> => {
        calls.push(`heatmap/${scope}/${period}`);
        return { meta: { scope, period, generated_at: "2026-06-25T00:00:00.000Z" }, cells: [] };
      },
      readAssignments: async (ids: readonly number[]) => { calls.push("assignments"); assignmentIds.push([...ids]); return null; },
      skipAssignments: false,
    },
  };
}

describe("ranking row projections", () => {
  test("retains rank order, missing-lookup filtering, zero flow and current totals", () => {
    const items = [{ rank: 1, id: 999, value: 500, prev_rank: null }, { rank: 2, id: 2, value: 0, prev_rank: null }, { rank: 3, id: 1, value: 10, prev_rank: null }];
    const before = structuredClone(items);
    expect(projectRepoRows(items, LOOKUP)).toEqual([
      { owner: "fixture", name: "repo-2", lang: "TypeScript", gained: 0, total: 100_001 },
      { owner: "fixture", name: "repo-1", lang: "TypeScript", gained: 10, total: 100_000 },
    ]);
    expect(projectRepoRows(items, LOOKUP, "total").map((row) => row.gained)).toEqual([undefined, undefined]);
    expect(projectRepoRows(items, null)).toEqual([]);
    expect(items).toEqual(before);
  });

  test("growth and newcomers retain their own metric fields", () => {
    expect(projectGrowthRows(ITEMS.slice(0, 2), LOOKUP).map((row) => row.rate)).toEqual([0, 5.25]);
    expect(projectGrowthRows([{ rank: 1, id: 1, value: 1, prev_rank: null }], LOOKUP)[0].rate).toBeUndefined();
    expect(projectNewcomerRows([{ rank: 1, id: 1, value: 1, prev_rank: null }], LOOKUP, "en")[0].crossedDate).toBeUndefined();
  });

  test.each(["en", "ja", "zh", "zh-TW", "ko", "es", "fr"] as Locale[])("%s formats newcomer dates through the existing locale helper", (locale) => {
    expect(projectNewcomerRows(ITEMS.slice(0, 1), LOOKUP, locale)[0].crossedDate).toBe(dateLabel(locale, "2026-06-01"));
  });
});

describe("ranking detail reads and display budgets", () => {
  test.each(["year", "month"] as const)("%s reads exactly three metrics plus heat, lookup, registry and bounded leading assignments", async (window) => {
    const fixture = readers();
    const period = window === "year" ? "2026" : "2026-06";
    const data = await loadRankingDetailData(window, period, "en", fixture.options);
    expect(fixture.calls).toEqual([`${window}/${period}/flow`, "lookup", "registry", `${window}/${period}/growth`, `${window}/${period}/new`, `heatmap/${window}/${period}`, "assignments"]);
    expect(data?.rows).toHaveLength(100);
    expect(data?.most).toHaveLength(18);
    expect(data?.fastest).toHaveLength(10);
    expect(data?.newcomers).toHaveLength(10);
    expect(fixture.assignmentIds).toEqual([Array.from({ length: 18 }, (_, i) => i + 1)]);
    expect(data?.dateModified).toBe(GENERATED_AT);
    expect(data?.asOf).toBe("June 21, 2026");
  });

  test("week never reads growth, newcomers or heatmap and uses only its flow timestamp", async () => {
    const fixture = readers();
    const data = await loadRankingDetailData("week", "2026-W26", "en", fixture.options);
    expect(fixture.calls).toEqual(["week/2026-W26/flow", "lookup", "registry", "assignments"]);
    expect(data?.fastest).toEqual([]);
    expect(data?.newcomers).toEqual([]);
    expect(data?.growth).toBeNull();
    expect(data?.newc).toBeNull();
    expect(data?.heat).toBeNull();
    expect(data?.dateModified).toBe(GENERATED_AT);
  });

  test.each([{ missingFlow: true }, { missingLookup: true }])("required missing view %j returns null before assignment reads", async (missing) => {
    const fixture = readers(missing);
    expect(await loadRankingDetailData("month", "2026-06", "en", fixture.options)).toBeNull();
    expect(fixture.calls).not.toContain("assignments");
  });

  test("missing optional panels preserve the flow page and timestamp", async () => {
    const fixture = readers();
    const data = await loadRankingDetailData("month", "2026-06", "en", {
      ...fixture.options,
      readRank: async (window, period, _dim, metric) => metric === "flow" ? rank(window as "month", period, "flow") : null,
      readHeatmap: async () => null,
    });
    expect(data?.rows).toHaveLength(100);
    expect(data?.fastest).toEqual([]);
    expect(data?.newcomers).toEqual([]);
    expect(data?.dateModified).toBe(GENERATED_AT);
  });

  test("slices before joining and keeps category leads on the original first 18 items", async () => {
    const fixture = readers({ sparseLookup: true });
    const data = await loadRankingDetailData("year", "2026", "en", fixture.options);
    expect(data?.rows).toHaveLength(99);
    expect(data?.rows[0].name).toBe("repo-2");
    expect(data?.rows.at(-1)?.name).toBe("repo-100");
    expect(data?.most.at(-1)?.name).toBe("repo-19");
    expect(data?.fastest).toHaveLength(9);
    expect(data?.newcomers).toHaveLength(9);
    expect(fixture.assignmentIds[0].at(-1)).toBe(18);
  });

  test("Cloudflare skips assignment reads without suppressing language category exits", async () => {
    await runWithCloudflareWorkersHostForTests(true, async () => {
      const fixture = readers();
      const options = { ...fixture.options, skipAssignments: undefined };
      const registry: CategoryRegistry = { rules_version: "fixture", generated_at: GENERATED_AT, dimensions: [{ id: "language", label: "Language", categories: [{ id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", public: true, count: 1, sitemap: true, minimum_repo_count: 1 }] }] };
      const data = await loadRankingDetailData("week", "2026-W26", "en", { ...options, readRegistry: async () => registry });
      expect(fixture.calls).not.toContain("assignments");
      expect(data?.categoryLinks.map((link) => link.href)).toEqual(["/categories/language/typescript"]);
    });
  });

  test("named product display limits retain existing values", () => {
    expect([PULSE_MOVER_LIMIT, PULSE_GIANT_LIMIT, PULSE_ANNIVERSARY_LIMIT, RANKING_DETAIL_ROW_LIMIT, PRIMARY_PANEL_LIMIT, SECONDARY_PANEL_LIMIT, RANKING_FEATURED_LIMIT]).toEqual([8, 6, 8, 100, 18, 10, 3]);
  });
});

describe("shared ranking locale and navigation contracts", () => {
  const periods = {
    year: 2026,
    yearLink: { kind: "year", year: 2026, href: "/rankings/2026", label: "2026" },
    month: { kind: "month", year: 2026, month: 6, period: "2026-06", href: "/rankings/2026/6", label: "June 2026" },
    week: { kind: "week", year: 2026, week: 26, period: "2026-W26", href: "/rankings/2026/W26", label: "2026-W26" },
    allTime: { kind: "all-time", href: "/rankings", label: "Full history" },
  } as const;

  test.each(["en", "ja", "zh", "zh-TW", "ko", "es", "fr"] as Locale[])("%s preserves resolved links, labels, badges and structured data", async (locale) => {
    const t = await getDictionary(locale);
    const href = (path: string) => localizedPath(locale, path);
    const links = periodSwitcherLinks(periods, currentUtcPeriods(new Date("2026-07-08T12:00:00.000Z")), href, locale, t);
    expect(Object.values(links).map((link) => link.href)).toEqual(["/rankings", "/rankings/2026", "/rankings/2026/6", "/rankings/2026/W26"].map(href));
    expect(Object.values(links).map((link) => link.label)).toEqual([t.rankings.allTime, t.year.label, t.month.label, t.week.label]);
    expect(links.month.value).toBe(availablePeriodLabel(locale, periods.month, { fullHistory: t.rankings.fullHistory }));
    expect(links.month.badge).toBe(t.common.latestAvailable.replace("{period}", String(links.month.value)));
    expect(links.week.badge).toBe(t.common.latestAvailable.replace("{period}", String(links.week.value)));
    const data = rankingDetailStructuredData({ locale, path: href("/rankings/2026/6"), label: "2026-06", rows: projectRepoRows(ITEMS.slice(0, 1), LOOKUP), dateModified: GENERATED_AT });
    expect(data.map((item) => item["@type"])).toEqual(["CollectionPage", "Dataset", "ItemList"]);
    expect(JSON.stringify(data)).toContain(href("/fixture/repo-1"));
    expect(JSON.stringify(data)).toContain(GENERATED_AT);
  });

  test("fallback periods preserve resolver hrefs and full-history labels", async () => {
    const t = await getDictionary("en");
    const fallback = { kind: "fallback", href: "/rankings", label: "Full history" } as const;
    const links = periodSwitcherLinks({ ...periods, yearLink: fallback, month: fallback, week: fallback }, currentUtcPeriods(), (path) => path, "en", t);
    expect(Object.values(links).map((link) => link.href)).toEqual(Array(4).fill("/rankings"));
    expect(Object.values(links).map((link) => link.value)).toEqual(Array(4).fill(t.rankings.fullHistory));
  });
});
