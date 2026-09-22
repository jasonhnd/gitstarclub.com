import { beforeEach, describe, expect, mock, test } from "bun:test";

let value: unknown = null;
let repoValue: Record<string, unknown> | null = null;
let seriesPresent = true;
let missingPaths = new Set<string>();
let reads: Array<{ path: string; bust?: string }> = [];

const validRepo = {
  id: 1,
  node_id: "R_1",
  owner: "example",
  owner_type: "Organization",
  name: "repo",
  full_name: "example/repo",
  current_stars: 100,
  active: true,
  tracked_since: null,
  d: 0.8,
};

async function mockRead(
  path: string,
  schema: { parse: (input: unknown) => unknown },
  opts: { bust?: string } = {},
) {
  reads.push({ path, bust: opts.bust });
  if (missingPaths.has(path)) return null;
  let raw: unknown;
  if (path === "canonical/v2/meta.json") raw = value;
  else if (path.endsWith("repos/1.json")) raw = repoValue ? { "1": repoValue } : {};
  else if (
    path.endsWith("repo-monthly/1.json") ||
    path.endsWith("repo-weekly/1.json") ||
    path.endsWith("repo-recent-daily/1.json")
  ) {
    raw = seriesPresent ? { "1": [] } : {};
  } else raw = {};
  return raw == null ? null : schema.parse(raw);
}

mock.module("@/lib/data/source", () => ({
  readView: mockRead,
  readAuthoritativeView: mockRead,
  readRequiredView: async (
    path: string,
    schema: { parse: (input: unknown) => unknown },
    opts: { bust?: string } = {},
  ) => {
    const result = await mockRead(path, schema, opts);
    if (result === null) throw new Error(`${path} missing`);
    return result;
  },
}));

beforeEach(() => {
  value = null;
  repoValue = { ...validRepo };
  seriesPresent = true;
  missingPaths = new Set();
  reads = [];
  delete process.env.PREFLIGHT_RELAX_EMPTY_SHARDS;
  delete process.env.VERCEL_ENV;
});

/*
 * Import after installing the source mock: both the preflight reader and the
 * canonical validator must exercise the same authoritative read contract.
 */
const { preflightCanonical, runPreflightStep, PREFLIGHT_BUCKETS_PER_JOB } = await import("./preflight");
const { readCanonicalPreflight } = await import("../canonical-preflight");

describe("preflightCanonical", () => {
  test("route preflight uses a cache key distinct from the workflow step", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    reads = [];

    await readCanonicalPreflight("refresh-test");
    await preflightCanonical("refresh-test");

    expect(reads.filter(({ path }) => path === "canonical/v2/meta.json").map(({ bust }) => bust)).toEqual([
      "refresh-test-route-preflight",
      "refresh-test-workflow-preflight",
      "refresh-test-workflow-preflight",
    ]);
  });

  test("accepts compatible metadata and canonical shards before mutation steps", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    reads = [];

    await expect(preflightCanonical("refresh-test")).resolves.toEqual({
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    });
    expect(reads.filter(({ path }) => path === "canonical/v2/meta.json")).toEqual([
      { path: "canonical/v2/meta.json", bust: "refresh-test-workflow-preflight" },
      { path: "canonical/v2/meta.json", bust: "refresh-test-workflow-preflight" },
    ]);
  });

  test("accepts legacy metadata without generated_at when canonical shards are compatible", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
    };

    await expect(preflightCanonical("refresh-legacy")).resolves.toMatchObject({ generated_at: null });
  });

  test("fails closed when metadata is missing or incompatible", async () => {
    value = null;
    await expect(preflightCanonical("refresh-missing")).rejects.toThrow("canonical/v2/meta.json missing");

    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    await expect(preflightCanonical("refresh-invalid")).rejects.toThrow();
  });

  test("route preflight rejects legacy repo rows before lease acquisition", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    repoValue = { ...validRepo, active: undefined, d: undefined };

    await expect(readCanonicalPreflight("refresh-incompatible")).rejects.toThrow(
      "historical repo(s) are missing a finite anchoring factor d",
    );
  });

  test("workflow preflight step reads one bucket window and defers the next offset", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    reads = [];

    const first = await runPreflightStep("refresh-window");
    expect(first.nextPreflightOffset).toBe(PREFLIGHT_BUCKETS_PER_JOB);
    expect(first.preflight).toBeUndefined();
    expect(first.bucketStart).toBe(0);
    expect(first.bucketCount).toBe(PREFLIGHT_BUCKETS_PER_JOB);
    expect(reads.filter(({ path }) => path === "canonical/v2/meta.json")).toEqual([
      { path: "canonical/v2/meta.json", bust: "refresh-window-workflow-preflight" },
    ]);
    expect(reads.filter(({ path }) => path.startsWith("canonical/v2/") && path !== "canonical/v2/meta.json").length).toBe(
      PREFLIGHT_BUCKETS_PER_JOB * 4,
    );

    const last = await runPreflightStep("refresh-window", {
      preflightOffset: 28,
      preflightAcc: {
        repoRecords: 1,
        monthlyRecords: 1,
        weeklyRecords: 1,
        recentDailyRecords: 1,
        validatedShards: 112,
        schemaFailures: 0,
        placeholderShards: 0,
      },
    });
    expect(last.nextPreflightOffset).toBeUndefined();
    expect(last.preflight).toEqual({
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    });
  });

  test("workflow preflight rejects empty time-series families before mutation steps", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    seriesPresent = false;

    await expect(preflightCanonical("refresh-empty-series")).rejects.toThrow(
      "canonical/v2/repo-monthly: no repository records",
    );
  });

  test("preview policy lets a hop-4 missing-shard window continue", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    process.env.PREFLIGHT_RELAX_EMPTY_SHARDS = "1";
    missingPaths = new Set([
      "canonical/v2/repos/4.json",
      "canonical/v2/repos/6.json",
      "canonical/v2/repos/7.json",
      "canonical/v2/repo-monthly/5.json",
      "canonical/v2/repo-monthly/6.json",
    ]);

    const hop = await runPreflightStep("refresh-hop4-preview", { preflightOffset: 4 });
    expect(hop.nextPreflightOffset).toBe(8);
    expect(hop.preflight).toBeUndefined();
    expect(hop.preflightAcc?.placeholderShards).toBe(5);
    expect(hop.preflightAcc?.schemaFailures).toBe(0);
  });

  test("production-shaped env refuses the preview empty-shard policy", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    process.env.PREFLIGHT_RELAX_EMPTY_SHARDS = "1";
    process.env.VERCEL_ENV = "production";
    missingPaths = new Set(["canonical/v2/repos/4.json"]);

    await expect(runPreflightStep("refresh-hop4-prod", { preflightOffset: 4 })).rejects.toThrow(
      "canonical/v2/repos/4.json: missing",
    );
  });

  test("preview policy does not void the run when time-series families are empty", async () => {
    value = {
      seam_date: "2026-05-30",
      schema_ver: 1,
      folded_through: { month: "2026-05", week: "2026-W22" },
      generated_at: "2026-06-02T14:32:57.214Z",
    };
    process.env.PREFLIGHT_RELAX_EMPTY_SHARDS = "1";
    seriesPresent = false;

    await expect(preflightCanonical("refresh-preview-empty-series")).resolves.toMatchObject({
      seam_date: "2026-05-30",
      schema_ver: 1,
    });
  });
});
