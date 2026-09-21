import { describe, expect, test } from "bun:test";
import { CANONICAL_SHARD_READ_CONCURRENCY } from "@/lib/workflows/canonical-validation";
import { canonicalModelLoadPlan, collectPeriodsFromSeriesShard, mergeCompleteBucketShards, wantedCanonicalFamilies, WRITE_CONCURRENCY_CF } from "./io";

describe("mergeCompleteBucketShards", () => {
  test("merges every complete shard", () => {
    expect(mergeCompleteBucketShards("repos", [{ "1": { id: 1 } }, {}, { "4": { id: 4 } }])).toEqual({
      "1": { id: 1 },
      "4": { id: 4 },
    });
  });

  test("fails closed and identifies every missing bucket", () => {
    expect(() => mergeCompleteBucketShards("repo-monthly", [{}, null, {}, null])).toThrow(
      "canonical/v2/repo-monthly: missing required shard(s) 1,3",
    );
  });
});

describe("canonicalModelLoadPlan", () => {
  test("overlaps families on Vercel and serializes them on CF", () => {
    expect(canonicalModelLoadPlan({ HOSTING_TARGET: "vercel" })).toEqual({
      shardConcurrency: CANONICAL_SHARD_READ_CONCURRENCY,
      parallelFamilies: true,
      writeConcurrency: 12,
    });
    expect(canonicalModelLoadPlan({ HOSTING_TARGET: "cf" })).toEqual({
      shardConcurrency: 1,
      parallelFamilies: false,
      writeConcurrency: WRITE_CONCURRENCY_CF,
    });
    expect(canonicalModelLoadPlan({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" }).parallelFamilies).toBe(true);
  });

  test("wantedCanonicalFamilies defaults to every family and honors a hop subset", () => {
    expect([...wantedCanonicalFamilies()]).toEqual(["repos", "monthly", "weekly", "recentDaily", "siteDaily"]);
    expect([...wantedCanonicalFamilies({ families: ["repos", "weekly"] })]).toEqual(["repos", "weekly"]);
  });
});

describe("collectPeriodsFromSeriesShard", () => {
  test("unions period strings and ignores malformed cells", () => {
    const periods = new Set<string>();
    collectPeriodsFromSeriesShard(
      {
        "1": [
          ["2026-W20", 3],
          ["2026-W21", 1],
        ],
        "2": [["2026-W20", 9], ["nope"]],
        "3": "skip",
      },
      periods,
    );
    expect([...periods].sort()).toEqual(["2026-W20", "2026-W21"]);
  });
});
