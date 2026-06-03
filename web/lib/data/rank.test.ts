import { test, expect, describe } from "bun:test";
import type { RankItem, RepoLookupEntry, OrgLookupEntry } from "@/lib/contracts";

// rank.ts transitively imports source.ts, whose module-scope BLOB_BASE is captured at load.
// source.ts is a singleton; whichever test file loads it first fixes that value process-wide.
// Set a base here (before the dynamic import below) so the full lib/data/ suite is order-safe —
// these pure join helpers never fetch, but importing rank.ts must not crash on an empty base.
process.env.BLOB_BASE_URL ??= "https://blob.example.com";

// Dynamic import (post-env) so source.ts evaluates with a non-empty base regardless of file order.
const { joinRepoRank, joinOrgRank } = await import("./rank");

// Pure lookup-join helpers only. getRank/getRankBase fetch Blob and are NOT tested here.
// Contract under test (rank.ts §lookup-join):
//   - rank rows carry id/login + value; display fields are merged in from lookup/*.
//   - rows whose id (repo) / login (org) is MISSING from the lookup are DROPPED.

const repoItem = (over: Partial<RankItem> = {}): RankItem => ({
  rank: 1,
  value: 100,
  prev_rank: null,
  ...over,
});

const repoEntry = (over: Partial<RepoLookupEntry> = {}): RepoLookupEntry => ({
  owner: "torvalds",
  name: "linux",
  full_name: "torvalds/linux",
  owner_type: "User",
  language: "C",
  current_stars: 180000,
  ...over,
});

const orgEntry = (over: Partial<OrgLookupEntry> = {}): OrgLookupEntry => ({
  login: "vercel",
  owner_type: "Organization",
  repo_count: 42,
  current_stars_sum: 250000,
  ...over,
});

describe("joinRepoRank", () => {
  test("merges lookup display fields onto each rank item (keyed by stringified id)", () => {
    const items = [repoItem({ rank: 1, id: 10, value: 500 })];
    const lookup: Record<string, RepoLookupEntry> = {
      "10": repoEntry({ full_name: "torvalds/linux", current_stars: 180000 }),
    };

    const result = joinRepoRank(items, lookup);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rank: 1,
      id: 10,
      value: 500,
      full_name: "torvalds/linux",
      owner: "torvalds",
      name: "linux",
      current_stars: 180000,
    });
  });

  test("drops items whose id is missing from the lookup", () => {
    const items = [
      repoItem({ rank: 1, id: 10 }),
      repoItem({ rank: 2, id: 99 }), // no lookup entry → dropped
      repoItem({ rank: 3, id: 20 }),
    ];
    const lookup: Record<string, RepoLookupEntry> = {
      "10": repoEntry({ full_name: "a/one" }),
      "20": repoEntry({ full_name: "b/two" }),
    };

    const result = joinRepoRank(items, lookup);

    expect(result.map((r) => r.id)).toEqual([10, 20]);
    expect(result.map((r) => r.full_name)).toEqual(["a/one", "b/two"]);
  });

  test("drops items with no id at all (undefined id)", () => {
    const items = [repoItem({ rank: 1 }), repoItem({ rank: 2, id: 10 })];
    const lookup: Record<string, RepoLookupEntry> = { "10": repoEntry() };

    const result = joinRepoRank(items, lookup);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
  });

  test("preserves input order and narrows id to a guaranteed number", () => {
    const items = [
      repoItem({ rank: 1, id: 3 }),
      repoItem({ rank: 2, id: 1 }),
      repoItem({ rank: 3, id: 2 }),
    ];
    const lookup: Record<string, RepoLookupEntry> = {
      "1": repoEntry(),
      "2": repoEntry(),
      "3": repoEntry(),
    };

    const result = joinRepoRank(items, lookup);

    expect(result.map((r) => r.id)).toEqual([3, 1, 2]);
    for (const r of result) expect(typeof r.id).toBe("number");
  });

  test("returns an empty array when nothing matches", () => {
    const items = [repoItem({ rank: 1, id: 1 })];
    expect(joinRepoRank(items, {})).toEqual([]);
  });

  test("lookup fields override item-overlapping fields (lookup spread is last)", () => {
    // RankItem has no display fields, but verify spread precedence explicitly:
    // a stray same-named field on the item must be overwritten by the lookup value.
    const item = { ...repoItem({ rank: 1, id: 5 }), current_stars: 1 } as RankItem;
    const lookup: Record<string, RepoLookupEntry> = {
      "5": repoEntry({ current_stars: 999 }),
    };

    const result = joinRepoRank([item], lookup);

    expect(result[0].current_stars).toBe(999);
  });
});

describe("joinOrgRank", () => {
  test("merges lookup display fields onto each rank item (keyed by login)", () => {
    const items = [repoItem({ rank: 1, login: "vercel", value: 250000 })];
    const lookup: Record<string, OrgLookupEntry> = {
      vercel: orgEntry({ repo_count: 42, current_stars_sum: 250000 }),
    };

    const result = joinOrgRank(items, lookup);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rank: 1,
      login: "vercel",
      value: 250000,
      owner_type: "Organization",
      repo_count: 42,
      current_stars_sum: 250000,
    });
  });

  test("drops items whose login is missing from the lookup", () => {
    const items = [
      repoItem({ rank: 1, login: "vercel" }),
      repoItem({ rank: 2, login: "ghost" }), // no lookup entry → dropped
      repoItem({ rank: 3, login: "google" }),
    ];
    const lookup: Record<string, OrgLookupEntry> = {
      vercel: orgEntry({ login: "vercel" }),
      google: orgEntry({ login: "google" }),
    };

    const result = joinOrgRank(items, lookup);

    expect(result.map((r) => r.login)).toEqual(["vercel", "google"]);
  });

  test("drops items with no login at all (undefined login)", () => {
    const items = [repoItem({ rank: 1 }), repoItem({ rank: 2, login: "vercel" })];
    const lookup: Record<string, OrgLookupEntry> = { vercel: orgEntry() };

    const result = joinOrgRank(items, lookup);

    expect(result).toHaveLength(1);
    expect(result[0].login).toBe("vercel");
  });

  test("returns an empty array when nothing matches", () => {
    const items = [repoItem({ rank: 1, login: "vercel" })];
    expect(joinOrgRank(items, {})).toEqual([]);
  });
});
