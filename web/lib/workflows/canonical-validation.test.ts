import { describe, expect, test } from "bun:test";
import { FetchTimeoutError } from "@/lib/fetch-timeout.mjs";
import { withWorkerEnv } from "@/lib/workers-host/runtime-env";
import { HISTORY_AVAILABILITY_KEY, readHistoryAvailability } from "./history-availability";
import {
  CANONICAL_SHARD_READ_CONCURRENCY,
  CANONICAL_SHARD_READ_CONCURRENCY_CF,
  EXPECTED_CANONICAL_SHARDS,
  PREVIEW_EMPTY_SHARD_POLICY,
  canonicalShardReadConcurrency,
  emptyCanonicalPreflightAcc,
  emptySeriesPreflightFailures,
  mergeCanonicalPreflightAcc,
  resolveCanonicalEmptyShardPolicy,
  validateCanonicalGeneration,
  type CanonicalShardReader,
} from "./canonical-validation";

const historicalRepo = {
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

const unavailableHistory = {
  seed_date: "2026-10-19",
  monthly: "unavailable",
  prior_year_heatmap: "unavailable",
  set_at: "2026-10-25T09:00:00Z",
} as const;

function historyReader(marker: unknown, overrides: Record<string, unknown> = {}): CanonicalShardReader {
  return async (path) => {
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (path === HISTORY_AVAILABILITY_KEY) return marker ?? null;
    if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
    if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W43", 1]] };
    if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-10-25", 1]] };
    return {};
  };
}

describe("validateCanonicalGeneration", () => {
  test("valid preview marker accepts empty monthly shards without creating records or placeholders", async () => {
    const result = await withWorkerEnv({ DEPLOY_ENV: "pre" }, () => validateCanonicalGeneration("marked", {
      reader: historyReader(unavailableHistory),
    }));
    expect(result.failures).toEqual([]);
    expect(result.manifest.complete).toBe(true);
    expect(result.acc.monthlyRecords).toBe(0);
    expect(result.placeholders).toEqual([]);
    expect(result.manifest.shards.filter(({ kind }) => kind === "repo-monthly").every(({ records }) => records === 0)).toBe(true);
    expect(emptySeriesPreflightFailures(result.acc, "fail-closed", readHistoryAvailability(unavailableHistory, { DEPLOY_ENV: "pre" }))).toEqual([]);
  });

  test.each([
    ["403", new Error("view fetch canonical/v2/history-availability.json -> 403")],
    ["timeout", new FetchTimeoutError("https://blob.example.com/canonical/v2/history-availability.json", 5)],
    ["invalid JSON", new SyntaxError("JSON Parse error: Unexpected EOF")],
  ] as const)("a thrown marker read (%s) rejects canonical validation", async (_label, error) => {
    const reader = historyReader(unavailableHistory);
    await expect(withWorkerEnv({ DEPLOY_ENV: "pre" }, () => validateCanonicalGeneration("marker-throw", {
      reader: async (path, schema) => {
        if (path === HISTORY_AVAILABILITY_KEY) throw error;
        return reader(path, schema);
      },
    }))).rejects.toThrow(error.message);
  });

  test.each([null, {}, { ...unavailableHistory, monthly: "available" }, { ...unavailableHistory, seed_date: "2026-02-30" }])(
    "absent or malformed preview marker retains monthly failure: %p", async (marker) => {
      const result = await withWorkerEnv({ DEPLOY_ENV: "pre" }, () => validateCanonicalGeneration("unmarked", {
        reader: historyReader(marker),
      }));
      expect(result.failures).toEqual(["canonical/v2/repo-monthly: no repository records for 1 canonical repo(s)"]);
      expect(result.manifest.complete).toBe(false);
      expect(result.schemaFailures).toBe(0);
    },
  );

  test.each([{}, { DEPLOY_ENV: "production" }, { DEPLOY_ENV: "pre", VERCEL_ENV: "production" }])(
    "valid marker cannot relax completeness outside preview: %p", async (env) => {
      const reads: string[] = [];
      const reader = historyReader(unavailableHistory);
      const result = await withWorkerEnv(env, () => validateCanonicalGeneration("strict", {
        reader: async (path, schema) => { reads.push(path); return reader(path, schema); },
      }));
      expect(result.failures).toEqual(["canonical/v2/repo-monthly: no repository records for 1 canonical repo(s)"]);
      expect(reads).not.toContain(HISTORY_AVAILABILITY_KEY);
    },
  );

  test("valid preview marker preserves weekly, daily, and repository family requirements", async () => {
    const result = await withWorkerEnv({ DEPLOY_ENV: "pre" }, () => validateCanonicalGeneration("marked-empty-series", {
      reader: historyReader(unavailableHistory, {
        "canonical/v2/repo-weekly/1.json": {},
        "canonical/v2/repo-recent-daily/1.json": {},
      }),
    }));
    const expected = [
      "canonical/v2/repo-weekly: no repository records for 1 canonical repo(s)",
      "canonical/v2/repo-recent-daily: no repository records for 1 canonical repo(s)",
    ];
    expect(result.failures).toEqual(expected);
    const availability = readHistoryAvailability(unavailableHistory, { DEPLOY_ENV: "pre" });
    expect(emptySeriesPreflightFailures(result.acc, "fail-closed", availability)).toEqual(expected);
    expect(emptySeriesPreflightFailures(emptyCanonicalPreflightAcc(), "fail-closed", availability)).toEqual([
      "canonical/v2/repos: no repository records",
    ]);
  });

  test("valid preview marker preserves missing files, schemas, identity, anchoring, buckets, and orphan checks", async () => {
    const result = await withWorkerEnv({ DEPLOY_ENV: "pre" }, () => validateCanonicalGeneration("marked-invalid", {
      reader: historyReader(unavailableHistory, {
        "canonical/v2/repo-monthly/0.json": null,
        "canonical/v2/repo-monthly/2.json": { broken: true },
        "canonical/v2/repos/1.json": { "1": { ...historicalRepo, id: 2, d: undefined } },
        "canonical/v2/repo-monthly/3.json": { "999": [["2026-09", 1]] },
      }),
    }));
    expect(result.manifest.complete).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      "canonical/v2/repo-monthly/0.json: missing",
      expect.stringContaining("canonical/v2/repo-monthly/2.json: schema"),
      "canonical/v2/repos: 1 historical repo(s) are missing a finite anchoring factor d",
      "canonical/v2/repos: 1 record key(s) do not match their repository id",
      "canonical/v2: 1 record(s) are stored in the wrong bucket",
      "canonical/v2/repo-monthly: 1 record(s) reference repositories absent from canonical/v2/repos",
    ]));
  });

  test("produces a complete checksummed receipt for every required shard", async () => {
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
      if (path.endsWith("repo-monthly/1.json")) return { "1": [["2026-06", 1]] };
      if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W26", 1]] };
      if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-06-30", 1]] };
      return {};
    };
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
    expect(result.activeRepoIds).toEqual(new Set(["1"]));
  });

  test("rejects a populated repo inventory with empty time-series families", async () => {
    const reader: CanonicalShardReader = async (path) =>
      path.endsWith("repos/1.json") ? { "1": historicalRepo } : {};

    const result = await validateCanonicalGeneration("refresh-empty-series", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(result.manifest.complete).toBe(false);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        "canonical/v2/repo-monthly: no repository records for 1 canonical repo(s)",
        "canonical/v2/repo-weekly: no repository records for 1 canonical repo(s)",
        "canonical/v2/repo-recent-daily: no repository records for 1 canonical repo(s)",
      ]),
    );
  });

  test("rejects time-series records whose repository is absent from repos shards", async () => {
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
      if (path.endsWith("repo-monthly/7.json")) return { "999": [["2026-06", 1]] };
      if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W26", 1]] };
      if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-06-30", 1]] };
      return {};
    };

    const result = await validateCanonicalGeneration("refresh-orphan-series", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(result.manifest.complete).toBe(false);
    expect(result.failures).toContain(
      "canonical/v2/repo-monthly: 1 record(s) reference repositories absent from canonical/v2/repos",
    );
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

  test("caps shard reads at the requested concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const reader: CanonicalShardReader = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return {};
    };

    await validateCanonicalGeneration("refresh-concurrency", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
      concurrency: 2,
      checksum: false,
      finalize: false,
    });

    expect(maxInFlight).toBe(2);
    expect(maxInFlight).toBeLessThanOrEqual(CANONICAL_SHARD_READ_CONCURRENCY);
  });

  test("validates one bucket window without treating empty sibling buckets as missing families", async () => {
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
      if (path.endsWith("repo-monthly/1.json")) return { "1": [["2026-06", 1]] };
      if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W26", 1]] };
      if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-06-30", 1]] };
      return {};
    };

    const first = await validateCanonicalGeneration("refresh-window", {
      reader,
      generatedAt: "2026-07-17T00:00:00.000Z",
      buckets: [0, 1, 2, 3],
      checksum: false,
      finalize: false,
    });

    expect(first.failures).toEqual([]);
    expect(first.checked).toBe(16);
    expect(first.acc.repoRecords).toBe(1);
    expect(first.acc.monthlyRecords).toBe(1);
    expect(first.manifest.shards.every((shard) => shard.sha256 === "0".repeat(64))).toBe(true);
    expect(emptySeriesPreflightFailures(first.acc)).toEqual([]);
  });

  test("defers empty-family failures until every bucket window is counted", () => {
    const empty = emptyCanonicalPreflightAcc();
    const mid = mergeCanonicalPreflightAcc(empty, {
      repoRecords: 1,
      monthlyRecords: 0,
      weeklyRecords: 0,
      recentDailyRecords: 0,
      validatedShards: 16,
      schemaFailures: 0,
      placeholderShards: 0,
    });
    expect(emptySeriesPreflightFailures(mid)).toEqual(
      expect.arrayContaining([
        "canonical/v2/repo-monthly: no repository records for 1 canonical repo(s)",
        "canonical/v2/repo-weekly: no repository records for 1 canonical repo(s)",
        "canonical/v2/repo-recent-daily: no repository records for 1 canonical repo(s)",
      ]),
    );
  });

  test("tightens shard-read concurrency on the CF Workers host", () => {
    expect(canonicalShardReadConcurrency({ HOSTING_TARGET: "vercel" })).toBe(CANONICAL_SHARD_READ_CONCURRENCY);
    expect(canonicalShardReadConcurrency({ HOSTING_TARGET: "cf" })).toBe(CANONICAL_SHARD_READ_CONCURRENCY_CF);
    expect(canonicalShardReadConcurrency({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" })).toBe(
      CANONICAL_SHARD_READ_CONCURRENCY,
    );
  });

  test("preview placeholder policy treats missing shards as empty {} and stays complete", async () => {
    const missing = new Set([
      "canonical/v2/repos/4.json",
      "canonical/v2/repos/6.json",
      "canonical/v2/repos/7.json",
      "canonical/v2/repo-monthly/5.json",
      "canonical/v2/repo-monthly/6.json",
    ]);
    const reader: CanonicalShardReader = async (path) => {
      if (missing.has(path)) return null;
      if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
      if (path.endsWith("repo-monthly/1.json")) return { "1": [["2026-06", 1]] };
      if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W26", 1]] };
      if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-06-30", 1]] };
      return {};
    };

    const result = await validateCanonicalGeneration("refresh-preview-placeholders", {
      reader,
      generatedAt: "2026-09-22T01:26:07.000Z",
      emptyShardPolicy: PREVIEW_EMPTY_SHARD_POLICY,
      checksum: false,
    });

    expect(result.failures).toEqual([]);
    expect(result.placeholders).toEqual([...missing].toSorted());
    expect(result.acc.placeholderShards).toBe(missing.size);
    expect(result.manifest.complete).toBe(true);
    expect(result.manifest.validated_shards).toBe(EXPECTED_CANONICAL_SHARDS);
    expect(result.invariants.canonical_placeholder_shards).toBe(missing.size);
  });

  test("preview hop-4 window with 14 missing shards does not fail closed", async () => {
    const present = new Set(["canonical/v2/repos/5.json", "canonical/v2/repo-weekly/4.json"]);
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/5.json")) return { "5": { ...historicalRepo, id: 5, node_id: "R_5" } };
      if (path.endsWith("repo-weekly/4.json")) return {};
      if (present.has(path)) return {};
      return null;
    };

    const closed = await validateCanonicalGeneration("refresh-hop4-closed", {
      reader,
      generatedAt: "2026-09-22T01:26:07.000Z",
      buckets: [4, 5, 6, 7],
      checksum: false,
      finalize: false,
      emptyShardPolicy: "fail-closed",
    });
    expect(closed.failures).toHaveLength(14);
    expect(closed.failures.every((item) => item.endsWith(": missing"))).toBe(true);
    expect(closed.manifest.complete).toBe(false);

    const relaxed = await validateCanonicalGeneration("refresh-hop4-preview", {
      reader,
      generatedAt: "2026-09-22T01:26:07.000Z",
      buckets: [4, 5, 6, 7],
      checksum: false,
      finalize: false,
      emptyShardPolicy: PREVIEW_EMPTY_SHARD_POLICY,
    });
    expect(relaxed.failures).toEqual([]);
    expect(relaxed.placeholders).toHaveLength(14);
    expect(relaxed.acc.placeholderShards).toBe(14);
    expect(relaxed.acc.validatedShards).toBe(16);
    expect(relaxed.manifest.complete).toBe(true);
  });

  test("preview placeholder policy still fail-closes schema and identity errors", async () => {
    const reader: CanonicalShardReader = async (path) => {
      if (path.endsWith("repos/2.json")) return { broken: { id: "not-a-number" } };
      if (path.endsWith("repos/1.json")) return { "1": historicalRepo };
      if (path.endsWith("repo-monthly/1.json")) return { "1": [["2026-06", 1]] };
      if (path.endsWith("repo-weekly/1.json")) return { "1": [["2026-W26", 1]] };
      if (path.endsWith("repo-recent-daily/1.json")) return { "1": [["2026-06-30", 1]] };
      return {};
    };

    const result = await validateCanonicalGeneration("refresh-preview-schema", {
      reader,
      generatedAt: "2026-09-22T01:26:07.000Z",
      emptyShardPolicy: PREVIEW_EMPTY_SHARD_POLICY,
      checksum: false,
    });
    expect(result.manifest.complete).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.stringContaining("canonical/v2/repos/2.json: schema")]));
  });

  test("preview placeholder policy skips family-wide empty failures", async () => {
    const reader: CanonicalShardReader = async (path) =>
      path.endsWith("repos/1.json") ? { "1": historicalRepo } : {};

    const result = await validateCanonicalGeneration("refresh-preview-empty-family", {
      reader,
      generatedAt: "2026-09-22T01:26:07.000Z",
      emptyShardPolicy: PREVIEW_EMPTY_SHARD_POLICY,
      checksum: false,
    });
    expect(result.failures).toEqual([]);
    expect(result.manifest.complete).toBe(true);
    expect(emptySeriesPreflightFailures(result.acc, PREVIEW_EMPTY_SHARD_POLICY)).toEqual([]);
    expect(emptySeriesPreflightFailures(result.acc, "fail-closed")).toEqual(
      expect.arrayContaining([
        "canonical/v2/repo-monthly: no repository records for 1 canonical repo(s)",
      ]),
    );
  });

  test("resolveCanonicalEmptyShardPolicy arms only when DEPLOY_ENV=pre", () => {
    expect(resolveCanonicalEmptyShardPolicy({})).toBe("fail-closed");
    expect(resolveCanonicalEmptyShardPolicy({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1" })).toBe("fail-closed");
    expect(resolveCanonicalEmptyShardPolicy({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", HOSTING_TARGET: "cf" })).toBe(
      "fail-closed",
    );
    expect(resolveCanonicalEmptyShardPolicy({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", DEPLOY_ENV: "pre" })).toBe(
      PREVIEW_EMPTY_SHARD_POLICY,
    );
    expect(
      resolveCanonicalEmptyShardPolicy({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", DEPLOY_ENV: "production" }),
    ).toBe("fail-closed");
    expect(
      resolveCanonicalEmptyShardPolicy({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", VERCEL_ENV: "production" }),
    ).toBe("fail-closed");
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
