import { describe, expect, test } from "bun:test";
import { GitHubHttpError, type RepoMetadata } from "@/lib/github";
import { buildModel } from "../recompute/model";
import { allTime } from "../recompute/ranks";
import { repoEntities } from "../recompute/entities";
import type { MetadataBucketProgress, ReposLookup, ReposShardEntry, WhitelistEntry, WhitelistSnapshot } from "@/lib/contracts";
import {
  buildMetadataShard,
  coalesceMetadataBucketProgress,
  MAX_METADATA_TRANSIENT_ATTEMPTS,
  metadataTransientRetryDelayMs,
  refreshMetadataBucketWithDeps,
  type MetadataDeps,
} from "./metadata";

function entry(id: number, stars: number): WhitelistEntry {
  return {
    id,
    node_id: `R_${id}`,
    full_name: `owner/repo-${id}`,
    owner: "owner",
    name: `repo-${id}`,
    stars,
  };
}

function metadata(id: number, currentStars: number): RepoMetadata {
  return {
    full_name: `owner/repo-${id}`,
    owner: "owner",
    owner_type: "Organization",
    name: `repo-${id}`,
    description: `repo ${id}`,
    language: "TypeScript",
    languages: [{ name: "TypeScript", size: 100, color: "#3178c6" }],
    topics: ["testing"],
    created_at: "2020-01-01T00:00:00Z",
    current_stars: currentStars,
    is_archived: false,
  };
}

function previous(id: number, trackedSince: string | null): ReposShardEntry {
  return {
    id,
    node_id: `R_${id}`,
    owner: "owner",
    owner_type: "Organization",
    name: `repo-${id}`,
    full_name: `owner/repo-${id}`,
    current_stars: 20_000 + id,
    active: true,
    tracked_since: trackedSince,
    d: 1,
  };
}

describe("metadata tracking lifecycle", () => {
  test("uses GraphQL counts, retains a drop, and re-entry preserves first tracked_since", () => {
    const initial = { "1": previous(1, null), "2": previous(2, "2026-06-01") };
    const dropped = buildMetadataShard({
      entries: [entry(1, 99_999)], // Search differs deliberately
      previous: initial,
      lookup: {} as ReposLookup,
      github: new Map([[1, metadata(1, 100_123)]]),
      newcomers: new Set(),
      trackedSince: "2026-07-17",
      fetchedAt: "2026-07-17T02:00:00.000Z",
    });

    expect(dropped["1"]).toMatchObject({ active: true, current_stars: 100_123 });
    expect(dropped["2"]).toMatchObject({ active: false, current_stars: 20_002, tracked_since: "2026-06-01" });

    const reentered = buildMetadataShard({
      entries: [entry(1, 100_000), entry(2, 20_100), entry(3, 10_100)],
      previous: dropped,
      lookup: {} as ReposLookup,
      github: new Map([
        [1, metadata(1, 100_456)],
        [2, metadata(2, 20_222)],
        [3, metadata(3, 10_111)],
      ]),
      newcomers: new Set([2, 3]),
      trackedSince: "2026-07-24",
      fetchedAt: "2026-07-24T02:00:00.000Z",
    });

    expect(reentered["2"]).toMatchObject({ active: true, current_stars: 20_222, tracked_since: "2026-06-01" });
    expect(reentered["3"]).toMatchObject({ active: true, current_stars: 10_111, tracked_since: "2026-07-24" });
  });

  test("materializes null tracked_since when retaining a legacy drop", () => {
    const legacy = previous(4, null);
    delete legacy.tracked_since;
    const retained = buildMetadataShard({
      entries: [],
      previous: { "4": legacy },
      lookup: {} as ReposLookup,
      github: new Map(),
      newcomers: new Set(),
      trackedSince: "2026-07-17",
      fetchedAt: "2026-07-17T02:00:00.000Z",
    });

    expect(retained["4"]).toMatchObject({ active: false, tracked_since: null });
    expect("tracked_since" in retained["4"]).toBe(true);
  });

  test("fails closed when GraphQL cannot authoritatively resolve every active repository", () => {
    expect(() =>
      buildMetadataShard({
        entries: [entry(1, 10_000)],
        previous: {},
        lookup: {} as ReposLookup,
        github: new Map(),
        newcomers: new Set([1]),
        trackedSince: "2026-07-17",
        fetchedAt: "2026-07-17T02:00:00.000Z",
      }),
    ).toThrow("GraphQL metadata missing for 1 active repository");
  });
});

function whitelistFor(ids: number[]): WhitelistSnapshot {
  return {
    run_id: "refresh-test",
    generated_at: "2026-09-21T18:03:22.274Z",
    count: ids.length,
    entries: ids.map((id) => entry(id, 10_000 + id)),
    diff: { added: ids, dropped: [] },
  };
}

function fakeMetadata(ids: number[]) {
  const state = {
    progress: null as MetadataBucketProgress | null,
    shard: null as Record<string, ReposShardEntry> | null,
    fetches: [] as string[][],
    sleeps: [] as number[],
  };
  const deps: MetadataDeps = {
    readWhitelist: async () => whitelistFor(ids),
    readLookup: async () => ({}) as ReposLookup,
    readPrevShard: async () => ({}),
    readProgress: async () => state.progress,
    writeProgress: async (_owner, progress) => {
      state.progress = structuredClone(progress);
    },
    writeShard: async (_owner, _bucket, shard) => {
      state.shard = structuredClone(shard);
    },
    fetchBatch: async (nodeIds) => {
      state.fetches.push(nodeIds);
      const out = new Map<number, RepoMetadata>();
      for (const nodeId of nodeIds) {
        const id = Number(nodeId.slice(2));
        out.set(id, metadata(id, 10_000 + id));
      }
      return out;
    },
    now: () => "2026-09-22T00:00:00.000Z",
    sleep: async (ms) => {
      state.sleeps.push(ms);
    },
  };
  return { state, deps };
}

describe("metadata GraphQL resume", () => {
  test("resets borrowed zero-row budgets but preserves an in-run split checkpoint", () => {
    const borrowed: MetadataBucketProgress = {
      v: 1, bucket: 1, fetched: {}, transient_attempts: 17, last_error: "GitHub GraphQL 502",
    };
    expect(coalesceMetadataBucketProgress(1, null, borrowed)).toMatchObject({
      fetched: {}, transient_attempts: 0, last_error: null,
    });
    const own = { ...borrowed, pending_pages: [[1], [33]], transient_attempts: 2 };
    expect(coalesceMetadataBucketProgress(1, own, borrowed)).toBe(own);
  });

  test("checkpoints a 100-id 502 as two 50-id pages and resumes without retrying the parent", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => 1 + 32 * i);
    const { state, deps } = fakeMetadata(ids);
    state.progress = { v: 1, bucket: 1, fetched: {}, transient_attempts: 17 };
    const fetch = deps.fetchBatch;
    deps.fetchBatch = async (nodeIds) => {
      if (nodeIds.length > 50) {
        state.fetches.push(nodeIds);
        throw new GitHubHttpError("graphql", 502, "Bad Gateway");
      }
      return fetch(nodeIds);
    };
    expect(await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).toMatchObject({ retryMetadata: true });
    expect(state.progress?.pending_pages).toEqual([ids.slice(0, 50), ids.slice(50)]);
    expect(state.progress?.transient_attempts).toBe(0);
    expect(await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).toMatchObject({ from_github: 100, skipped_count: 0 });
    expect(state.fetches.map((page) => page.length)).toEqual([100, 50, 50]);
    expect(state.progress?.pending_pages).toEqual([]);
  });

  test("recursively bisects an offending id, records its skip, and resumes it without refetching", async () => {
    const { state, deps } = fakeMetadata([1, 33, 65, 97]);
    const fetch = deps.fetchBatch;
    deps.fetchBatch = async (nodeIds) => {
      if (nodeIds.includes("R_33")) {
        state.fetches.push(nodeIds);
        throw new GitHubHttpError("graphql", 502, "Bad Gateway");
      }
      return fetch(nodeIds);
    };
    deps.readPrevShard = async () => ({ "33": previous(33, "2025-01-01") });
    let result;
    for (let hop = 0; hop < 8; hop++) {
      result = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
      if (!result.retryMetadata) break;
    }
    expect(result).toMatchObject({ from_github: 3, skipped_count: 1, skipped: [{
      id: 33, node_id: "R_33", full_name: "owner/repo-33", reason: "graphql_502", value_status: "retained",
    }] });
    expect(state.fetches).toEqual([
      ["R_1", "R_33", "R_65", "R_97"], ["R_1", "R_33"], ["R_1"], ["R_33"], ["R_65", "R_97"],
    ]);
    expect(state.shard?.["33"]?.current_stars).toBe(20_033);
    const count = state.fetches.length;
    await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(state.fetches).toHaveLength(count);
    expect(state.progress?.skipped).toHaveLength(1);
  });

  test("a successful subpage resets the transient budget before a later failure", async () => {
    const { state, deps } = fakeMetadata([1, 33]);
    state.progress = { v: 1, bucket: 1, fetched: {}, pending_pages: [[1], [33]], transient_attempts: 11 };
    const fetch = deps.fetchBatch;
    deps.fetchBatch = async (ids) => {
      if (ids.includes("R_33")) throw new GitHubHttpError("graphql", 503, "unavailable");
      return fetch(ids);
    };
    expect(await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).toMatchObject({ retryMetadata: true });
    expect(state.progress?.transient_attempts).toBe(1);
    expect(state.progress?.pending_pages).toEqual([[33]]);
    expect(Object.keys(state.progress?.fetched ?? {})).toEqual(["1"]);
  });

  test("borrowing an exhausted zero-row checkpoint starts with one attempt rather than failing fast", async () => {
    const { state, deps } = fakeMetadata([1]);
    deps.readWhitelist = async () => ({ ...whitelistFor([1]), metadata_resume_run_id: "refresh-failed" });
    deps.readProgress = async (runId) => runId === "refresh-failed"
      ? { v: 1, bucket: 1, fetched: {}, transient_attempts: 17 }
      : state.progress;
    deps.fetchBatch = async () => { throw new GitHubHttpError("graphql", 503, "unavailable"); };
    expect(await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).toMatchObject({ retryMetadata: true });
    expect(state.progress?.transient_attempts).toBe(1);
    expect(state.sleeps).toEqual([]);
  });

  test("a recorded skip prefers the last published count over an unpublished canonical update", () => {
    const shard = buildMetadataShard({
      entries: [entry(1, 90_000)], previous: { "1": previous(1, "2025-01-01") },
      lookup: { "1": { full_name: "owner/repo-1", owner: "owner", name: "repo-1", owner_type: "Organization", current_stars: 12_345 } },
      github: new Map(), skipped: new Set([1]), newcomers: new Set(),
      trackedSince: "2026-09-21", fetchedAt: "2026-09-22T00:00:00.000Z",
    });
    expect(shard["1"].current_stars).toBe(12_345);
  });

  test("only exhausted GraphQL 502 may skip; auth and unrelated service failures do not", async () => {
    for (const [source, status] of [["graphql", 401], ["graphql", 503], ["graphql", 429], ["search", 502]] as const) {
      const { state, deps } = fakeMetadata([1]);
      deps.fetchBatch = async () => { throw new GitHubHttpError(source, status, "failure"); };
      if (status === 401) await expect(refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).rejects.toThrow("401");
      else expect(await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).toMatchObject({ retryMetadata: true });
      expect(state.progress?.skipped ?? []).toEqual([]);
      expect(state.shard).toBeNull();
    }
  });

  test("skips keep old entity and ranking values; missing newcomers have no numeric rows", async () => {
    const { state, deps } = fakeMetadata([1, 33]);
    const old = { ...previous(1, "2025-01-01"), created_at: "2020-01-01", fetched_at: "2026-09-20T00:00:00.000Z" };
    deps.readPrevShard = async () => ({ "1": old });
    deps.fetchBatch = async () => { throw new GitHubHttpError("graphql", 502, "Bad Gateway"); };
    await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    const result = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(result).toMatchObject({ skipped_count: 2, from_github: 0 });
    expect(state.progress?.skipped).toMatchObject([
      { id: 1, value_status: "retained" }, { id: 33, value_status: "missing" },
    ]);
    expect(state.shard?.["1"]).toEqual(old);
    expect(state.shard?.["33"]).toBeUndefined();
    const repos = Object.fromEntries(Object.entries(state.shard!).map(([id, row]) => [id, { ...row, d: row.d! }]));
    const model = buildModel({ repos, monthly: {}, weekly: {}, recentDaily: {}, siteDailyByYear: {} }, "2025-12-31");
    const entities = repoEntities(model, { byRepo: new Map(), periods: [], rowsByPeriod: new Map() }).views;
    expect(entities.get("entity/repo/1.json")?.current_stars).toBe(20_001);
    expect(entities.has("entity/repo/33.json")).toBe(false);
    const ranks = allTime(model, deps.now());
    expect(ranks.get("rank/all-time/repo/stock.json")?.items).toEqual([{ rank: 1, id: 1, value: 20_001, prev_rank: null }]);
    expect(ranks.get("rank/all-time/org/stock.json")?.items[0]?.value).toBe(20_001);
  });

  test("records null/deleted node results as missing instead of substituting Search stars", async () => {
    const { state, deps } = fakeMetadata([1]);
    deps.fetchBatch = async () => new Map();
    const result = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(result).toMatchObject({ skipped_count: 1, skipped: [{ id: 1, reason: "not_returned", value_status: "missing" }] });
    expect(state.shard).toEqual({});
  });

  test("metadataTransientRetryDelayMs backs off and caps at 60s", () => {
    expect(metadataTransientRetryDelayMs(1)).toBe(8_000);
    expect(metadataTransientRetryDelayMs(2)).toBe(16_000);
    expect(metadataTransientRetryDelayMs(3)).toBe(32_000);
    expect(metadataTransientRetryDelayMs(4)).toBe(60_000);
  });

  test("persists a successful batch and resumes the same hop after GraphQL 503", async () => {
    const ids = Array.from({ length: 101 }, (_, index) => 1 + index * 32);
    const { state, deps } = fakeMetadata(ids);
    let calls = 0;
    deps.fetchBatch = async (nodeIds) => {
      calls += 1;
      state.fetches.push(nodeIds);
      if (calls === 1) {
        const out = new Map<number, RepoMetadata>();
        for (const nodeId of nodeIds) {
          const id = Number(nodeId.slice(2));
          out.set(id, metadata(id, 10_000 + id));
        }
        return out;
      }
      throw new GitHubHttpError("graphql", 503, "error code: 503");
    };

    const first = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(first).toMatchObject({ retryMetadata: true, from_github: 100, bucket: 1 });
    expect(first.error).toContain("GitHub GraphQL 503");
    expect(state.shard).toBeNull();
    expect(Object.keys(state.progress?.fetched ?? {})).toHaveLength(100);
    expect(state.progress?.transient_attempts).toBe(1);

    deps.fetchBatch = async (nodeIds) => {
      state.fetches.push(nodeIds);
      expect(nodeIds).toEqual(["R_3201"]);
      return new Map([[3201, metadata(3201, 13_201)]]);
    };

    const second = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(second.retryMetadata).toBeUndefined();
    expect(second).toMatchObject({ repos: 101, from_github: 101, bucket: 1 });
    expect(state.shard?.["1"]?.current_stars).toBe(10_001);
    expect(state.shard?.["3201"]?.current_stars).toBe(13_201);
    expect(state.sleeps).toContain(8_000);
  });

  test("borrows GraphQL batch progress from metadata_resume_run_id on a new run", async () => {
    const ids = [1, 33];
    const { state, deps } = fakeMetadata(ids);
    deps.readWhitelist = async () => ({
      ...whitelistFor(ids),
      metadata_resume_run_id: "refresh-failed",
    });
    const priorRepo = metadata(1, 10_001);
    deps.readProgress = async (progressRunId, bucket) => {
      void bucket;
      if (progressRunId === "refresh-failed") {
        return {
          v: 1,
          bucket: 1,
          fetched: { "1": priorRepo },
          transient_attempts: MAX_METADATA_TRANSIENT_ATTEMPTS,
          last_error: "GitHub GraphQL 502: error code: 502",
        };
      }
      return state.progress;
    };

    const done = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(done).toMatchObject({ repos: 2, from_github: 2, bucket: 1 });
    expect(state.fetches).toHaveLength(1);
    expect(state.fetches[0]).toEqual(["R_33"]);
    expect(state.shard?.["1"]?.current_stars).toBe(10_001);
  });

  test("throws after the transient hop budget so the run can fail closed", async () => {
    const { state, deps } = fakeMetadata([1]);
    state.progress = {
      v: 1,
      bucket: 1,
      fetched: {},
      transient_attempts: MAX_METADATA_TRANSIENT_ATTEMPTS - 1,
      last_error: "GitHub GraphQL 502: error code: 502",
    };
    deps.fetchBatch = async () => {
      throw new GitHubHttpError("graphql", 503, "error code: 503");
    };

    await expect(refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).rejects.toThrow("GitHub GraphQL 503");
    expect(state.progress?.transient_attempts).toBe(MAX_METADATA_TRANSIENT_ATTEMPTS);
    expect(state.shard).toBeNull();
  });

  test("persisted last_error omits secret canaries and keeps the GraphQL category", async () => {
    const canary = "ghp_CANARYMISSEDSINK1234567890abcd";
    const { state, deps } = fakeMetadata([1]);
    deps.fetchBatch = async () => {
      throw new GitHubHttpError("graphql", 503, `error code: 503 ${canary}`);
    };

    const first = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(first).toMatchObject({ retryMetadata: true });
    expect(state.progress?.transient_attempts).toBe(1);
    expect(state.progress?.last_error).toContain("GitHub GraphQL 503");
    expect(state.progress?.last_error).not.toContain("CANARY");
  });
});
