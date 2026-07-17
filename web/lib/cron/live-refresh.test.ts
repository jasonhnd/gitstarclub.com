import { beforeEach, describe, expect, test } from "bun:test";
import type { CurrentMonth, Heatmap, HotSnapshot, RankList, ReposLookup } from "@/lib/contracts";
import type { PublishLiveGenerationArgs } from "./live-publication";
import type { LiveRefreshDependencies } from "./live-refresh";

type Lookup = ReposLookup;

let lookup: Lookup | null = null;
let existingCurrentMonth: CurrentMonth | null = null;
let hotSnapshot: HotSnapshot | null = null;
let rankBases = new Map<string, RankList>();
let heatBases = new Map<string, Heatmap>();
let freshCounts = new Map<number, number>();
let publicationCalls: PublishLiveGenerationArgs[] = [];
let fetchedRefs: unknown[] = [];
let revalidated: string[] = [];
let events: string[] = [];
let revalidateError: Error | null = null;

const { reconcileCurrentMonth, refreshLiveViews } = await import("./live-refresh");

const NOW = new Date("2026-07-17T03:00:00.000Z");
const TODAY = "2026-07-17";

function currentMonthWrite(): CurrentMonth {
  const call = publicationCalls.at(-1)?.artifacts.find(({ path }) => path === "current_month.json");
  if (!call) throw new Error("current_month.json was not written");
  return call.data as CurrentMonth;
}

function hotSnapshotWrite(): HotSnapshot {
  const call = publicationCalls.at(-1)?.artifacts.find(({ path }) => path === "hot-snapshot.json");
  if (!call) throw new Error("hot-snapshot.json was not written");
  return call.data as HotSnapshot;
}

function testDependencies() {
  return {
    getReposLookup: async () => lookup,
    getCurrentMonth: async () => existingCurrentMonth,
    getHotSnapshot: async () => hotSnapshot,
    getRankBase: async (window, period, dim, metric) =>
      rankBases.get(`${window}/${period}/${dim}/${metric}`) ?? null,
    getHeatmapBase: async (scope, period) => heatBases.get(`${scope}/${period}`) ?? null,
    fetchStarCounts: async (refs) => {
      fetchedRefs = refs;
      return new Map(freshCounts);
    },
    submitLiveOverlayIndexNow: async () => {
      events.push("indexnow");
      return null;
    },
    revalidatePath: (path) => {
      events.push("revalidate");
      if (revalidateError) throw revalidateError;
      revalidated.push(path);
    },
    currentUtcPeriods: () => ({
      year: 2026,
      month: 7,
      monthPeriod: "2026-07",
      week: { year: 2026, week: 29 },
      weekPeriod: "2026-W29",
    }),
    isoWeek: () => ({ year: 2026, week: 29 }),
  } satisfies Partial<LiveRefreshDependencies>;
}

function dryOptions(now = NOW) {
  return { now, dependencies: testDependencies() };
}

function publishOptions(now = NOW) {
  return {
    now,
    dependencies: testDependencies(),
    publisher: async (args: PublishLiveGenerationArgs) => {
      events.push("commit");
      publicationCalls.push(args);
      return {
        generation: args.runId,
        manifest: `live/generations/${args.runId}/manifest.json`,
        previous_generation: "previous",
        published_at: args.createdAt,
      };
    },
    publication: { runId: "daily-2026-07-17-run", idempotencyKey: "daily:2026-07-17" },
  };
}

function state(overrides: Partial<CurrentMonth> = {}): CurrentMonth {
  return {
    month: "2026-07",
    updated: TODAY,
    daily_totals: [[TODAY, 15]],
    per_repo: {
      "1": [[TODAY, 10]],
      "2": [[TODAY, 5]],
    },
    current_stars: { "1": 110, "2": 205 },
    ...overrides,
  };
}

beforeEach(() => {
  lookup = {
    "1": {
      owner: "owner",
      name: "one",
      full_name: "owner/one",
      owner_type: "Organization",
      language: "TypeScript",
      current_stars: 100,
    },
    "2": {
      owner: "owner",
      name: "two",
      full_name: "owner/two",
      owner_type: "Organization",
      language: "TypeScript",
      current_stars: 200,
    },
  };
  existingCurrentMonth = null;
  hotSnapshot = null;
  rankBases = new Map();
  heatBases = new Map();
  freshCounts = new Map<number, number>([
    [1, 110],
    [2, 205],
  ]);
  publicationCalls = [];
  fetchedRefs = [];
  revalidated = [];
  events = [];
  revalidateError = null;
});

describe("refreshLiveViews", () => {
  test("throws when lookup/repos.json is unavailable", async () => {
    lookup = null;

    await expect(refreshLiveViews("daily", true, dryOptions())).rejects.toThrow("lookup unavailable");
  });

  test("dry runs poll a sample but write no Blob views and revalidate no paths", async () => {
    const result = await refreshLiveViews("daily", true, dryOptions());

    expect(result.dry).toBe(true);
    expect(result.writes).toEqual([]);
    expect(result.polled).toBe(2);
    expect(fetchedRefs).toHaveLength(2);
    expect(publicationCalls).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  test("an identical same-day retry preserves the full persisted day delta", async () => {
    existingCurrentMonth = state();

    await refreshLiveViews("daily", false, publishOptions());

    expect(currentMonthWrite()).toEqual(existingCurrentMonth);
  });

  test("same-day growth and star loss remain relative to the stable start-of-day baseline", async () => {
    existingCurrentMonth = state();
    freshCounts = new Map([
      [1, 112],
      [2, 198],
    ]);

    const result = await refreshLiveViews("daily", false, publishOptions());
    const written = currentMonthWrite();

    expect(written.per_repo).toEqual({
      "1": [[TODAY, 12]],
      "2": [[TODAY, -2]],
    });
    expect(written.daily_totals).toEqual([[TODAY, 10]]);
    expect(written.current_stars).toEqual({ "1": 112, "2": 198 });
    expect(result.day_total).toBe(10);
  });

  test("a partial result updates returned repos and preserves missing repos byte-for-byte", async () => {
    existingCurrentMonth = state({
      daily_totals: [["2026-07-16", 4], [TODAY, 15]],
      per_repo: {
        "1": [["2026-07-16", 3], [TODAY, 10]],
        "2": [["2026-07-16", 1], [TODAY, 5]],
      },
    });
    freshCounts = new Map([[1, 112]]);

    const result = await refreshLiveViews("daily", false, publishOptions());
    const written = currentMonthWrite();

    expect(written.per_repo["1"]).toEqual([["2026-07-16", 3], [TODAY, 12]]);
    expect(written.per_repo["2"]).toEqual(existingCurrentMonth.per_repo["2"]);
    expect(written.current_stars["2"]).toBe(205);
    expect(written.daily_totals).toEqual([["2026-07-16", 4], [TODAY, 17]]);
    expect(result.polled).toBe(1);
    expect(result.day_total).toBe(17);
    expect(hotSnapshotWrite().freshness?.current_month).toBe("2026-07-17T00:00:00.000Z");
  });

  test("duplicate scheduler delivery produces byte-equivalent current-month state", async () => {
    existingCurrentMonth = state({
      updated: "2026-07-16",
      daily_totals: [["2026-07-16", 4]],
      per_repo: { "1": [["2026-07-16", 3]], "2": [["2026-07-16", 1]] },
      current_stars: { "1": 100, "2": 200 },
    });

    await refreshLiveViews("daily", false, publishOptions());
    const first = structuredClone(currentMonthWrite());
    existingCurrentMonth = first;
    publicationCalls = [];

    await refreshLiveViews("daily", false, publishOptions());
    const second = currentMonthWrite();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("weekly reuse does not repoll or alter an already refreshed day", async () => {
    existingCurrentMonth = state();

    const result = await refreshLiveViews("weekly", false, publishOptions());

    expect(fetchedRefs).toEqual([]);
    expect(result.polled).toBe(0);
    expect(currentMonthWrite()).toEqual(existingCurrentMonth);
  });

  test("fails closed when a non-reuse GitHub poll returns no repositories", async () => {
    existingCurrentMonth = state();
    freshCounts = new Map();

    await expect(refreshLiveViews("daily", false, publishOptions())).rejects.toThrow(
      "GitHub returned no star counts; refusing to replace live state",
    );
    expect(publicationCalls).toEqual([]);
  });

  test("requires a publication lease instead of falling back to unsafe flat overwrites", async () => {
    await expect(refreshLiveViews("daily", false, dryOptions())).rejects.toThrow(
      "non-dry live refresh requires an acquired publication lease",
    );
    expect(publicationCalls).toEqual([]);
  });

  test("drops stale date-dependent content and exposes truthful section freshness", async () => {
    const rows = [{ rank: 1, id: 1, value: 10, prev_rank: null }];
    hotSnapshot = {
      generated_at: "2026-05-30T03:00:00.000Z",
      home: {
        year_spine: [["2026", 100]],
        current_month_top: { flow: rows, stock: rows },
        on_this_day: [{ id: 1, crossed: "10k", date: "2015-05-30" }],
      },
      current_year: { flow: rows, stock: rows },
      current_month: { flow: rows, stock: rows },
      all_time: { repo: rows, org: [{ rank: 1, login: "owner", value: 10, prev_rank: null }] },
    };

    await refreshLiveViews("daily", false, publishOptions());
    const written = hotSnapshotWrite();

    expect(written.home.on_this_day).toEqual([]);
    expect(written.freshness).toEqual({
      current_month: "2026-07-17T03:00:00.000Z",
      current_year: "2026-05-30T03:00:00.000Z",
      year_spine: "2026-05-30T03:00:00.000Z",
      on_this_day: null,
      all_time: "2026-07-17T03:00:00.000Z",
    });
    expect(written.generated_at).toBe("2026-05-30T03:00:00.000Z");
  });

  test("recomputes current-year rankings and year spine from base plus the fresh month", async () => {
    existingCurrentMonth = state();
    rankBases.set("year/2026/repo/flow", {
      meta: { window: "year", period: "2026", dim: "repo", metric: "flow", generated_at: "2026-07-16T02:00:00.000Z" },
      items: [
        { rank: 1, id: 1, value: 100, prev_rank: null },
        { rank: 2, id: 2, value: 50, prev_rank: null },
      ],
    });
    heatBases.set("year/2026", {
      meta: { scope: "year", period: "2026", generated_at: "2026-07-16T01:00:00.000Z" },
      cells: [["2026-01", 20], ["2026-07", 999]],
    });

    await refreshLiveViews("daily", false, publishOptions());
    const written = hotSnapshotWrite();

    expect(written.current_year.flow.map(({ id, value }) => [id, value])).toEqual([[1, 110], [2, 55]]);
    expect(written.home.year_spine).toEqual([["2026", 35]]);
    expect(written.freshness?.current_year).toBe("2026-07-16T02:00:00.000Z");
    expect(written.freshness?.year_spine).toBe("2026-07-16T01:00:00.000Z");
  });

  test("month rollover is deterministic and preserved both canonically and inside the generation", async () => {
    existingCurrentMonth = {
      month: "2026-06",
      updated: "2026-06-30",
      daily_totals: [["2026-06-30", 4]],
      per_repo: { "1": [["2026-06-30", 4]] },
      current_stars: { "1": 100, "2": 200 },
    };

    await refreshLiveViews("daily", false, publishOptions());
    const call = publicationCalls[0];
    const canonical = call.prerequisites?.find(({ path }) => path === "canonical/v2/pending/2026-06.json");
    const recovery = call.artifacts.find(({ path }) => path === "rollover/2026-06.json");

    expect(canonical?.data).toEqual(recovery?.data);
    expect(canonical?.data).toMatchObject({ period: "2026-06", frozen_at: "2026-07-17T00:00:00.000Z" });
  });

  test("revalidation and IndexNow run only after commit; failures remain post-commit diagnostics", async () => {
    revalidateError = new Error("ISR unavailable");

    const result = await refreshLiveViews("daily", false, publishOptions());

    expect(events[0]).toBe("commit");
    expect(events).toEqual(["commit", "revalidate", "indexnow"]);
    expect(result.generation).toBe("daily-2026-07-17-run");
    expect(result.post_commit_errors).toEqual(["revalidate: ISR unavailable"]);
  });
});

describe("reconcileCurrentMonth", () => {
  test("a month-boundary retry reconstructs the new month's original baseline", () => {
    const june: CurrentMonth = {
      month: "2026-06",
      updated: "2026-06-30",
      daily_totals: [["2026-06-30", 4]],
      per_repo: { "1": [["2026-06-30", 4]] },
      current_stars: { "1": 100, "2": 200 },
    };
    const first = reconcileCurrentMonth(lookup!, june, new Map([[1, 110], [2, 205]]), "2026-07-01").currentMonth;
    const second = reconcileCurrentMonth(lookup!, first, new Map([[1, 110], [2, 205]]), "2026-07-01").currentMonth;

    expect(first.per_repo).toEqual({ "1": [["2026-07-01", 10]], "2": [["2026-07-01", 5]] });
    expect(first.daily_totals).toEqual([["2026-07-01", 15]]);
    expect(second).toEqual(first);
  });
});
