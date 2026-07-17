import { describe, expect, test } from "bun:test";
import type { RepoMetadata } from "@/lib/github";
import type { ReposLookup, ReposShardEntry, WhitelistEntry } from "@/lib/contracts";
import { buildMetadataShard } from "./metadata";

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
