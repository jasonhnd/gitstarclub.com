import { beforeEach, describe, expect, mock, test } from "bun:test";

type Lookup = Record<string, { owner: string; name: string; current_stars: number }>;

let lookup: Lookup | null = null;
let putCalls: Array<{ path: string; data: unknown }> = [];
let fetchedRefs: unknown[] = [];
let revalidated: string[] = [];

mock.module("@/lib/data", () => ({
  getReposLookup: async () => lookup,
  getCurrentMonth: async () => null,
  getHotSnapshot: async () => null,
  getRankBase: async () => null,
  getHeatmapBase: async () => null,
}));

mock.module("@/lib/data/write", () => ({
  putView: async (path: string, data: unknown) => {
    putCalls.push({ path, data });
  },
}));

mock.module("@/lib/github", () => ({
  fetchStarCounts: async (refs: unknown[]) => {
    fetchedRefs = refs;
    return new Map<number, number>([
      [1, 110],
      [2, 205],
    ]);
  },
}));

mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

const { refreshLiveViews } = await import("./live-refresh");

beforeEach(() => {
  lookup = {
    "1": { owner: "owner", name: "one", current_stars: 100 },
    "2": { owner: "owner", name: "two", current_stars: 200 },
  };
  putCalls = [];
  fetchedRefs = [];
  revalidated = [];
});

describe("refreshLiveViews", () => {
  test("throws when lookup/repos.json is unavailable", async () => {
    lookup = null;

    await expect(refreshLiveViews("daily", true)).rejects.toThrow("lookup unavailable");
  });

  test("dry runs poll a sample but write no Blob views and revalidate no paths", async () => {
    const result = await refreshLiveViews("daily", true);

    expect(result.dry).toBe(true);
    expect(result.writes).toEqual([]);
    expect(result.polled).toBe(2);
    expect(fetchedRefs).toHaveLength(2);
    expect(putCalls).toEqual([]);
    expect(revalidated).toEqual([]);
  });
});
