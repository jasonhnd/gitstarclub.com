import { beforeEach, describe, expect, mock, test } from "bun:test";

let value: unknown = null;
let repoValue: Record<string, unknown> | null = null;
let seriesPresent = true;
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
  reads = [];
});

/*
 * Import after installing the source mock: both the preflight reader and the
 * canonical validator must exercise the same authoritative read contract.
 */
const { preflightCanonical } = await import("./preflight");
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
});
