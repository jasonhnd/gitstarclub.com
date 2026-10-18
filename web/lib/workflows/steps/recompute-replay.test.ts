import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";

// Replay safety of the rank and rest hops (#646). Storage is an in-memory fake
// with one-shot fault injection so each test can fail "before" or "after" a
// given write and then deliver the same hop again.

const REPO_BUCKETS = 32;
const RUN = "r1";
const OWNER = { runId: RUN, fencingToken: 1 };

type WriteKind = "mutable" | "version";
type Fault = { kind: WriteKind; match: RegExp };

const objects = new Map<string, unknown>();
const versions = new Map<string, unknown>();
let fault: Fault | null = null;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function maybeFail(kind: WriteKind, path: string): void {
  if (fault && fault.kind === kind && fault.match.test(path)) {
    fault = null;
    throw new Error(`injected ${kind} write failure: ${path}`);
  }
}

mock.module("@/lib/data/source", () => ({
  readAuthoritativeView: async (path: string) => clone(objects.get(path) ?? null),
  readRequiredView: async (path: string) => {
    const value = objects.get(path);
    if (value === undefined) throw new Error(`${path} missing`);
    return clone(value);
  },
}));
mock.module("@/lib/data/write", () => ({
  putView: async (path: string, data: unknown) => {
    maybeFail("mutable", path);
    objects.set(path, clone(JSON.parse(JSON.stringify(data))));
  },
  createView: async (path: string, data: unknown) => {
    objects.set(path, clone(JSON.parse(JSON.stringify(data))));
    return true;
  },
}));
mock.module("@/lib/storage", () => ({
  getWriteObjectStore: () => ({
    put: async (path: string, payload: string) => {
      maybeFail("version", path);
      versions.set(path, JSON.parse(payload));
    },
  }),
}));
mock.module("@/lib/workflows/lease", () => ({
  LEASE_HEARTBEAT_INTERVAL_MS: 300_000,
  renewWorkflowLease: async () => undefined,
}));

const { runRecomputeRankStep } = await import("./recompute-rank");
const { REST_OFFSET_LOOKUP, runRestRankHop } = await import("./recompute-rest");
const { readRankCarry } = await import("../recompute/io");

const PERIODS = Array.from({ length: 18 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
const MONTH_REPO_CARRY = `ops/workflows/${RUN}/recompute/month-repo-carry.json`;
const MONTH_ORG_CARRY = `ops/workflows/${RUN}/recompute/month-org-carry.json`;
const REST_CARRY = `ops/workflows/${RUN}/recompute/rest-carry.json`;
const restPartial = (bucket: number) => `ops/workflows/${RUN}/recompute/rest-part/${bucket}.json`;
const shardView = (bucket: number) => `views/${RUN}/categories/assignments/shards/${bucket}.json`;

/** Three repos in three orgs whose order changes from period to period. */
function seedPackedMonthWindow(): void {
  objects.set(`ops/workflows/${RUN}/recompute/month-win/meta.json`, {
    v: 1,
    kind: "month",
    seamPeriod: "2024-01",
    periods: PERIODS,
    buckets: REPO_BUCKETS,
    complete: true,
  });
  const flows = (id: number, p: number) => 30 - 10 * ((p + id) % 3) + id;
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const id = bucket >= 1 && bucket <= 3 ? bucket : null;
    const repos =
      id === null
        ? []
        : [
            {
              id,
              owner: `org${id}`,
              active: true,
              cells: PERIODS.map((_, p) => [p, flows(id, p), 100 * (p + 1) + id, 1000 + 50 * p + 100 * id]),
            },
          ];
    objects.set(`ops/workflows/${RUN}/recompute/month-win/${bucket}.json`, { v: 1, repos });
  }
}

function repoShardEntry(id: number) {
  return {
    id,
    node_id: `n${id}`,
    owner: `owner${id}`,
    owner_type: "User",
    name: `repo${id}`,
    full_name: `owner${id}/repo${id}`,
    language: "TypeScript",
    current_stars: 1000 * id,
    active: true,
    d: 1,
  };
}

function seedCanonicalRepos(): void {
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    objects.set(`canonical/v2/repos/${bucket}.json`, bucket === 3 ? { "3": repoShardEntry(3) } : {});
  }
}

beforeEach(() => {
  setSystemTime(new Date("2026-10-18T00:00:00.000Z"));
  objects.clear();
  versions.clear();
  fault = null;
  seedPackedMonthWindow();
  seedCanonicalRepos();
});

afterEach(() => {
  setSystemTime();
});

const repoHop = (offset: number) => runRecomputeRankStep(RUN, 1, { recomputePhase: "month", recomputeOffset: offset });
const orgHop = (offset: number) => runRecomputeRankStep(RUN, 1, { recomputePhase: "monthOrg", recomputeOffset: offset });
const rankViews = () => [...versions.keys()].filter((path) => path.includes("/rank/month/"));

async function referenceRun(hop: (offset: number) => Promise<unknown>): Promise<Map<string, unknown>> {
  for (const offset of [0, 8, 16]) await hop(offset);
  const snapshot = clone(versions);
  versions.clear();
  objects.delete(MONTH_REPO_CARRY);
  objects.delete(MONTH_ORG_CARRY);
  return snapshot;
}

describe("rank hops: replay safety (F02)", () => {
  test("replaying an earlier window returns the persisted result and leaves prev_rank unchanged", async () => {
    await repoHop(0);
    await repoHop(8);
    const viewsBefore = clone(versions);
    const carryBefore = clone(objects.get(MONTH_REPO_CARRY));

    const replay = await repoHop(0);

    expect(replay).toEqual({ files: 0, nextRecomputePhase: "month", nextRecomputeOffset: 8 });
    expect(versions).toEqual(viewsBefore);
    expect(objects.get(MONTH_REPO_CARRY)).toEqual(carryBefore);
    const first = versions.get(`views/${RUN}/rank/month/${PERIODS[0]}/repo/flow.json`) as { items: Array<{ prev_rank: number | null }> };
    expect(first.items.every((item) => item.prev_rank === null)).toBe(true);
  });

  test("a response lost after the carry write is redelivered without changing anything", async () => {
    const reference = await referenceRun(repoHop);
    await repoHop(0);
    const redelivered = await repoHop(0);
    expect(redelivered).toEqual({ files: 0, nextRecomputePhase: "month", nextRecomputeOffset: 8 });
    await repoHop(8);
    await repoHop(16);
    expect(versions).toEqual(reference);
  });

  test("a window whose carry nextPeriod matches recomputes from that input, also when redelivered", async () => {
    const reference = await referenceRun(repoHop);
    await repoHop(0);
    await repoHop(8);
    const last = await repoHop(16);
    expect(last.files).toBeGreaterThan(0);
    expect(last.nextRecomputePhase).toBe("monthOrg");
    const again = await repoHop(16);
    expect(again.files).toBe(last.files);
    expect(versions).toEqual(reference);
  });

  test("a future window with no carry fails before it writes rank views", async () => {
    await expect(repoHop(8)).rejects.toThrow(/month-repo-carry\.json.*8/);
    expect(rankViews()).toEqual([]);
  });

  test("a future window ahead of the carry fails before it writes rank views", async () => {
    await repoHop(0);
    const viewsBefore = clone(versions);
    await expect(repoHop(16)).rejects.toThrow(/month-repo-carry\.json.*nextPeriod 8.*16/);
    expect(versions).toEqual(viewsBefore);
  });

  test("a failure while writing rank views is retried to the same result", async () => {
    const reference = await referenceRun(repoHop);
    await repoHop(0);
    fault = { kind: "version", match: /rank\/month\/2024-10\/repo\/stock/ };
    await expect(repoHop(8)).rejects.toThrow(/injected/);
    expect(objects.get(MONTH_REPO_CARRY)).toMatchObject({ nextPeriod: 8 });
    await repoHop(8);
    await repoHop(16);
    expect(versions).toEqual(reference);
  });

  test("a failure at the carry write is retried to the same result", async () => {
    const reference = await referenceRun(repoHop);
    fault = { kind: "mutable", match: /month-repo-carry\.json$/ };
    await expect(repoHop(0)).rejects.toThrow(/injected/);
    expect(objects.has(MONTH_REPO_CARRY)).toBe(false);
    await repoHop(0);
    await repoHop(8);
    await repoHop(16);
    expect(versions).toEqual(reference);
  });

  test("the org hop is replay safe and rejects a future window", async () => {
    const reference = await referenceRun(orgHop);
    await orgHop(0);
    await orgHop(8);
    const viewsBefore = clone(versions);
    const carryBefore = clone(objects.get(MONTH_ORG_CARRY));

    expect(await orgHop(0)).toEqual({ files: 0, nextRecomputePhase: "monthOrg", nextRecomputeOffset: 8 });
    expect(versions).toEqual(viewsBefore);
    expect(objects.get(MONTH_ORG_CARRY)).toEqual(carryBefore);

    await orgHop(16);
    expect(versions).toEqual(reference);

    objects.delete(MONTH_ORG_CARRY);
    versions.clear();
    await expect(orgHop(8)).rejects.toThrow(/month-org-carry\.json/);
    expect(rankViews()).toEqual([]);
  });
});

describe("rank carry corruption (F04)", () => {
  test("readRankCarry returns null only when the object is absent", async () => {
    expect(await readRankCarry(RUN, "month", "repo")).toBeNull();
    objects.set(MONTH_REPO_CARRY, { v: 1, kind: "month", dim: "repo", nextPeriod: 8, flow: [], stock: [] });
    expect(await readRankCarry(RUN, "month", "repo")).toMatchObject({ nextPeriod: 8 });
  });

  test("a corrupt rank carry fails with the path and the field reason", async () => {
    objects.set(MONTH_REPO_CARRY, { v: 1, kind: "month", dim: "repo", nextPeriod: 8, flow: [["a", "x"]], stock: [] });
    await expect(readRankCarry(RUN, "month", "repo")).rejects.toThrow(`${MONTH_REPO_CARRY}: invalid rank carry`);
    await expect(readRankCarry(RUN, "month", "repo")).rejects.toThrow(/flow\[0\]/);
    await expect(repoHop(8)).rejects.toThrow(/flow\[0\]/);
    expect(rankViews()).toEqual([]);
  });

  test("a carry for another window kind is corrupt, not missing", async () => {
    objects.set(MONTH_REPO_CARRY, { v: 1, kind: "week", dim: "repo", nextPeriod: 8, flow: [], stock: [] });
    await expect(readRankCarry(RUN, "month", "repo")).rejects.toThrow(/kind/);
  });

  test("a carry past the end of the window is corrupt", async () => {
    objects.set(MONTH_REPO_CARRY, { v: 1, kind: "month", dim: "repo", nextPeriod: 99, flow: [], stock: [] });
    await expect(repoHop(8)).rejects.toThrow(/nextPeriod/);
  });
});

describe("rest ingest: replay safety (F03)", () => {
  const ingest = (bucket: number) => runRestRankHop(RUN, OWNER, bucket, "2026-10-18T00:00:00.000Z");
  const doneBuckets = () => (objects.get(REST_CARRY) as { doneBuckets: number[] } | undefined)?.doneBuckets ?? [];

  test("a shard write failure leaves the bucket undone so the retry writes the shard", async () => {
    fault = { kind: "version", match: /categories\/assignments\/shards\/3\.json$/ };
    await expect(ingest(3)).rejects.toThrow(/injected/);
    expect(doneBuckets()).not.toContain(3);
    expect(versions.has(shardView(3))).toBe(false);

    const retry = await ingest(3);

    expect(retry.files).toBe(1);
    expect(versions.has(shardView(3))).toBe(true);
    expect(doneBuckets()).toEqual([3]);
  });

  test("a partial write failure leaves the bucket undone", async () => {
    fault = { kind: "mutable", match: /rest-part\/3\.json$/ };
    await expect(ingest(3)).rejects.toThrow(/injected/);
    expect(doneBuckets()).toEqual([]);
    expect((await ingest(3)).files).toBe(1);
    expect(doneBuckets()).toEqual([3]);
  });

  test("a failure at the carry write retries without folding the bucket twice", async () => {
    fault = { kind: "mutable", match: /rest-carry\.json$/ };
    await expect(ingest(3)).rejects.toThrow(/injected/);
    expect(versions.has(shardView(3))).toBe(true);
    await ingest(3);
    const carry = objects.get(REST_CARRY) as { orgs: Array<{ repo_count: number }>; repoTop: unknown[]; doneBuckets: number[] };
    expect(carry.doneBuckets).toEqual([3]);
    expect(carry.repoTop).toHaveLength(1);
    expect(carry.orgs.map((org) => org.repo_count)).toEqual([1]);
  });

  test("a duplicate delivery of a finished bucket does not fold it twice", async () => {
    await ingest(3);
    const carryBefore = clone(objects.get(REST_CARRY));
    const duplicate = await ingest(3);
    expect(duplicate).toEqual({ files: 0, nextRecomputePhase: "rest", nextRecomputeOffset: 4 });
    expect(objects.get(REST_CARRY)).toEqual(carryBefore);
  });
});

describe("rest carry and partial corruption (F04)", () => {
  const lookup = () => runRestRankHop(RUN, OWNER, REST_OFFSET_LOOKUP, "2026-10-18T00:00:00.000Z");

  test("a missing rest partial still says it is missing", async () => {
    await expect(lookup()).rejects.toThrow(`${restPartial(0)}: missing rest partial`);
  });

  test("a corrupt rest partial fails with the path and the field reason, not as missing", async () => {
    objects.set(restPartial(0), { v: 1, lookup: "nope", search: [], active: [], languageLabels: {}, assignments: {} });
    const failure = await lookup().then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain(`${restPartial(0)}: invalid rest partial`);
    expect(failure).toContain("lookup");
    expect(failure).not.toContain("missing");
  });

  test("a corrupt rest carry fails with the path and the field reason", async () => {
    objects.set(REST_CARRY, { v: 1, generatedAt: "x", repoTop: [], orgs: [], newcomersMonth: {}, newcomersYear: {}, doneBuckets: ["3"] });
    await expect(runRestRankHop(RUN, OWNER, 3, "2026-10-18T00:00:00.000Z")).rejects.toThrow(
      `${REST_CARRY}: invalid rest carry`,
    );
    await expect(runRestRankHop(RUN, OWNER, 3, "2026-10-18T00:00:00.000Z")).rejects.toThrow(/doneBuckets/);
  });
});
