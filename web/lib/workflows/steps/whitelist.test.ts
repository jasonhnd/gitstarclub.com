import { describe, expect, test } from "bun:test";
import type { WhitelistEntry, WhitelistSnapshot } from "@/lib/contracts";
import { whitelistDiscoveryDate } from "./metadata";
import { refreshWhitelistWithDeps, type WhitelistDeps } from "./whitelist";

function entry(id: number): WhitelistEntry {
  return {
    id,
    node_id: `node-${id}`,
    full_name: `owner/repo-${id}`,
    owner: "owner",
    name: `repo-${id}`,
    stars: 10_000 + id,
  };
}

function snapshot(runId: string, ids: number[], generatedAt = "2026-07-16T01:00:00.000Z"): WhitelistSnapshot {
  return {
    run_id: runId,
    generated_at: generatedAt,
    count: ids.length,
    entries: ids.map(entry),
    diff: { added: [], dropped: [] },
  };
}

function fakeWhitelist() {
  const state = {
    publishedRunId: "published-old" as string | null,
    snapshots: new Map<string, WhitelistSnapshot>([["published-old", snapshot("published-old", [1])]]),
    searchEntries: [entry(1), entry(2)],
    searchCalls: 0,
    creates: 0,
    now: "2026-07-17T02:00:00.000Z",
  };
  const deps: WhitelistDeps = {
    readSnapshot: async (runId) => state.snapshots.get(runId) ?? null,
    readPublishedRunId: async () => state.publishedRunId,
    readLegacyIds: async () => null,
    readBootstrapIds: async () => [],
    search: async () => {
      state.searchCalls++;
      return structuredClone(state.searchEntries);
    },
    createSnapshot: async (runId, next) => {
      if (state.snapshots.has(runId)) return false;
      state.snapshots.set(runId, structuredClone(next));
      state.creates++;
      return true;
    },
    ensureOwnership: async () => {},
    now: () => state.now,
  };
  return { state, deps };
}

describe("published whitelist baseline", () => {
  test("a failed predecessor never advances baseline and same-run retry preserves its exact diff", async () => {
    const { state, deps } = fakeWhitelist();

    const first = await refreshWhitelistWithDeps("failed-run", 1, deps);
    const persisted = structuredClone(state.snapshots.get("failed-run")!);
    // Simulate a failure immediately after whitelist: the publish pointer stays old.
    state.searchEntries = [entry(1), entry(2), entry(3)];
    state.now = "2026-07-18T02:00:00.000Z";

    const retry = await refreshWhitelistWithDeps("failed-run", 1, deps);
    const successor = await refreshWhitelistWithDeps("successor-run", 2, deps);

    expect(first).toEqual({ count: 2, added: 1, dropped: 0 });
    expect(retry).toEqual(first);
    expect(state.snapshots.get("failed-run")).toEqual(persisted);
    expect(state.searchCalls).toBe(2); // first run + successor; retry did not search
    expect(successor).toEqual({ count: 3, added: 2, dropped: 0 });
    expect(state.snapshots.get("successor-run")?.diff.added).toEqual([2, 3]);
  });

  test("after publication the next run compares with the successfully published snapshot", async () => {
    const { state, deps } = fakeWhitelist();
    await refreshWhitelistWithDeps("published-new", 2, deps);
    state.publishedRunId = "published-new"; // the views/latest.json commit point
    state.searchEntries = [entry(2), entry(3)];
    state.now = "2026-07-24T02:00:00.000Z";

    const next = await refreshWhitelistWithDeps("next-run", 3, deps);

    expect(next).toEqual({ count: 2, added: 1, dropped: 1 });
    expect(state.snapshots.get("next-run")?.diff).toEqual({ added: [3], dropped: [1] });
  });

  test("a published pointer with no snapshot fails instead of falling back to a stale baseline", async () => {
    const { state, deps } = fakeWhitelist();
    state.snapshots.delete("published-old");

    await expect(refreshWhitelistWithDeps("next-run", 2, deps)).rejects.toThrow(
      "published whitelist snapshot for run published-old is missing",
    );
    expect(state.searchCalls).toBe(0);
    expect(state.snapshots.has("next-run")).toBe(false);
  });

  test("newcomer provenance is pinned to immutable snapshot discovery time", () => {
    const discovered = snapshot("run", [7], "2026-07-17T23:59:59.000Z");
    expect(whitelistDiscoveryDate(discovered)).toBe("2026-07-17");
  });
});
