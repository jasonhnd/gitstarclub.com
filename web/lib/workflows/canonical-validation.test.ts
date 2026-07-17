import { describe, expect, test } from "bun:test";
import { EXPECTED_CANONICAL_SHARDS, validateCanonicalGeneration, type CanonicalShardReader } from "./canonical-validation";

const historicalRepo = {
  id: 1,
  node_id: "R_1",
  owner: "example",
  owner_type: "Organization",
  name: "repo",
  full_name: "example/repo",
  current_stars: 100,
  tracked_since: null,
  d: 0.8,
};

describe("validateCanonicalGeneration", () => {
  test("produces a complete checksummed receipt for every required shard", async () => {
    const reader: CanonicalShardReader = async (path) => (path.endsWith("repos/0.json") ? { "1": historicalRepo } : {});
    const result = await validateCanonicalGeneration("refresh-test", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(result.failures).toEqual([]);
    expect(result.schemaFailures).toBe(0);
    expect(result.manifest).toMatchObject({
      run_id: "refresh-test",
      expected_shards: EXPECTED_CANONICAL_SHARDS,
      validated_shards: EXPECTED_CANONICAL_SHARDS,
      complete: true,
    });
    expect(result.manifest.shards).toHaveLength(EXPECTED_CANONICAL_SHARDS);
    expect(result.manifest.shards.every((shard) => /^[a-f0-9]{64}$/.test(shard.sha256))).toBe(true);
    expect(result.repoIds).toEqual(new Set(["1"]));
  });

  test("reports missing, invalid, and unanchored historical repositories", async () => {
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/1.json")) return null;
      if (path.endsWith("repos/2.json")) return { broken: { id: "not-a-number" } };
      if (path.endsWith("repos/0.json")) {
        return {
          "1": { ...historicalRepo, d: undefined },
          "2": { ...historicalRepo, id: 2, node_id: "R_2", full_name: "example/new", name: "new", d: undefined, tracked_since: "2026-07-17" },
        };
      }
      return {};
    };

    const result = await validateCanonicalGeneration("refresh-bad", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(result.manifest.complete).toBe(false);
    expect(result.manifest.validated_shards).toBe(EXPECTED_CANONICAL_SHARDS - 2);
    expect(result.schemaFailures).toBe(1);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "canonical/v2/repos/1.json: missing",
        expect.stringContaining("canonical/v2/repos/2.json: schema"),
        "canonical/v2/repos: 1 historical repo(s) are missing a finite anchoring factor d",
      ]),
    );
    expect(result.invariants.d_factor_newcomer_default_zero).toBe(1);
  });

  test.each([NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects a non-finite historical anchoring factor %p",
    async (d) => {
      const reader: CanonicalShardReader = async (path) =>
        path.endsWith("repos/0.json") ? { "1": { ...historicalRepo, d } } : {};

      const result = await validateCanonicalGeneration("refresh-non-finite", {
        reader,
        generatedAt: "2026-07-17T00:00:00.000Z",
      });

      expect(result.manifest.complete).toBe(false);
      expect(result.schemaFailures).toBe(1);
      expect(result.failures).toEqual(
        expect.arrayContaining([expect.stringContaining("canonical/v2/repos/0.json: schema")]),
      );
    },
  );
});
