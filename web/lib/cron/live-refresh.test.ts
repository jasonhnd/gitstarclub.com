import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { CurrentMonth } from "@/lib/contracts";

type Lookup = Record<string, { owner: string; name: string; current_stars: number }>;

let lookup: Lookup | null = null;
let existingCurrentMonth: CurrentMonth | null = null;
let freshCounts = new Map<number, number>();
let putCalls: Array<{ path: string; data: unknown }> = [];
let fetchedRefs: unknown[] = [];
let revalidated: string[] = [];

mock.module("@/lib/data", () => ({
  getReposLookup: async () => lookup,
  getCurrentMonth: async () => existingCurrentMonth,
  getHotSnapshot: async () => null,
  getRankBase: async () => null,
  getHeatmapBase: async () => null,
}));

mock.module("@/lib/data/write", () => ({
  putView: async (path: string, data: unknown) => {
    putCalls.push({ path, data });
  },
  createView: async () => true,
}));

mock.module("@/lib/github", () => ({
  fetchStarCounts: async (refs: unknown[]) => {
    fetchedRefs = refs;
    return new Map(freshCounts);
  },
  batchMetadata: async () => new Map(),
  searchWhitelist: async () => [],
}));

mock.module("@/lib/indexnow", () => ({
  submitLiveOverlayIndexNow: async () => ({ submitted: 0 }),
}));

mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { reconcileCurrentMonth, refreshLiveViews } = await import("./live-refresh");

const NOW = new Date("2026-07-17T03:00:00.000Z");
const TODAY = "2026-07-17";

function currentMonthWrite(): CurrentMonth {
  const call = putCalls.find(({ path }) => path === "current_month.json");
  if (!call) throw new Error("current_month.json was not written");
  return call.data as CurrentMonth;
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
    "1": { owner: "owner", name: "one", current_stars: 100 },
    "2": { owner: "owner", name: "two", current_stars: 200 },
  };
  existingCurrentMonth = null;
  freshCounts = new Map<number, number>([
    [1, 110],
    [2, 205],
  ]);
  putCalls = [];
  fetchedRefs = [];
  revalidated = [];
});

describe("refreshLiveViews", () => {
  test("throws when lookup/repos.json is unavailable", async () => {
    lookup = null;

    await expect(refreshLiveViews("daily", true, { now: NOW })).rejects.toThrow("lookup unavailable");
  });

  test("dry runs poll a sample but write no Blob views and revalidate no paths", async () => {
    const result = await refreshLiveViews("daily", true, { now: NOW });

    expect(result.dry).toBe(true);
    expect(result.writes).toEqual([]);
    expect(result.polled).toBe(2);
    expect(fetchedRefs).toHaveLength(2);
    expect(putCalls).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  test("an identical same-day retry preserves the full persisted day delta", async () => {
    existingCurrentMonth = state();

    await refreshLiveViews("daily", false, { now: NOW });

    expect(currentMonthWrite()).toEqual(existingCurrentMonth);
  });

  test("same-day growth and star loss remain relative to the stable start-of-day baseline", async () => {
    existingCurrentMonth = state();
    freshCounts = new Map([
      [1, 112],
      [2, 198],
    ]);

    const result = await refreshLiveViews("daily", false, { now: NOW });
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

    const result = await refreshLiveViews("daily", false, { now: NOW });
    const written = currentMonthWrite();

    expect(written.per_repo["1"]).toEqual([["2026-07-16", 3], [TODAY, 12]]);
    expect(written.per_repo["2"]).toEqual(existingCurrentMonth.per_repo["2"]);
    expect(written.current_stars["2"]).toBe(205);
    expect(written.daily_totals).toEqual([["2026-07-16", 4], [TODAY, 17]]);
    expect(result.polled).toBe(1);
    expect(result.day_total).toBe(17);
  });

  test("duplicate scheduler delivery produces byte-equivalent current-month state", async () => {
    existingCurrentMonth = state({
      updated: "2026-07-16",
      daily_totals: [["2026-07-16", 4]],
      per_repo: { "1": [["2026-07-16", 3]], "2": [["2026-07-16", 1]] },
      current_stars: { "1": 100, "2": 200 },
    });

    await refreshLiveViews("daily", false, { now: NOW });
    const first = structuredClone(currentMonthWrite());
    existingCurrentMonth = first;
    putCalls = [];

    await refreshLiveViews("daily", false, { now: NOW });
    const second = currentMonthWrite();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("weekly reuse does not repoll or alter an already refreshed day", async () => {
    existingCurrentMonth = state();

    const result = await refreshLiveViews("weekly", false, { now: NOW });

    expect(fetchedRefs).toEqual([]);
    expect(result.polled).toBe(0);
    expect(currentMonthWrite()).toEqual(existingCurrentMonth);
  });

  test("fails closed when a non-reuse GitHub poll returns no repositories", async () => {
    existingCurrentMonth = state();
    freshCounts = new Map();

    await expect(refreshLiveViews("daily", false, { now: NOW })).rejects.toThrow(
      "GitHub returned no star counts; refusing to replace live state",
    );
    expect(putCalls).toEqual([]);
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
