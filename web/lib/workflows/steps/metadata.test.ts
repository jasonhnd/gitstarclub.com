import { describe, expect, test } from "bun:test";
import { GitHubHttpError, type RepoMetadata } from "@/lib/github";
import type { MetadataBucketProgress, ReposLookup, ReposShardEntry, WhitelistEntry, WhitelistSnapshot } from "@/lib/contracts";
import {
  buildMetadataShard,
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
  test("metadataTransientRetryDelayMs backs off and caps at 60s", () => {
    expect(metadataTransientRetryDelayMs(1)).toBe(8_000);
    expect(metadataTransientRetryDelayMs(2)).toBe(16_000);
    expect(metadataTransientRetryDelayMs(3)).toBe(32_000);
    expect(metadataTransientRetryDelayMs(4)).toBe(60_000);
  });

  test("persists a successful batch and resumes the same hop after GraphQL 502", async () => {
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
      throw new GitHubHttpError("graphql", 502, "error code: 502");
    };

    const first = await refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps);
    expect(first).toMatchObject({ retryMetadata: true, from_github: 100, bucket: 1 });
    expect(first.error).toContain("GitHub GraphQL 502");
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
      throw new GitHubHttpError("graphql", 502, "error code: 502");
    };

    await expect(refreshMetadataBucketWithDeps("refresh-test", 1, 4, deps)).rejects.toThrow("GitHub GraphQL 502");
    expect(state.progress?.transient_attempts).toBe(MAX_METADATA_TRANSIENT_ATTEMPTS);
    expect(state.shard).toBeNull();
  });
});
