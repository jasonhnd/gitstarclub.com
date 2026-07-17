import { describe, expect, test } from "bun:test";
import { mergeCompleteBucketShards } from "./io";

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
