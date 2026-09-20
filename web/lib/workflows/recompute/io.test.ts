import { describe, expect, test } from "bun:test";
import {
  CANONICAL_SHARD_READ_CONCURRENCY,
  CANONICAL_SHARD_READ_CONCURRENCY_CF,
} from "@/lib/workflows/canonical-validation";
import { canonicalModelLoadPlan, mergeCompleteBucketShards, WRITE_CONCURRENCY_CF } from "./io";

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
      shardConcurrency: CANONICAL_SHARD_READ_CONCURRENCY_CF,
      parallelFamilies: false,
      writeConcurrency: WRITE_CONCURRENCY_CF,
    });
    expect(canonicalModelLoadPlan({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" }).parallelFamilies).toBe(true);
  });
});
