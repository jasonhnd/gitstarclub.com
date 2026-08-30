import { describe, expect, test } from "bun:test";
import { assertPublishedViewJsonSize, jsonByteLength, MAX_DATA_CACHE_JSON_BYTES } from "./view-size";

describe("published view JSON size", () => {
  test("measures UTF-8 byte length of JSON.stringify output", () => {
    expect(jsonByteLength({ a: "é" })).toBe(Buffer.byteLength(JSON.stringify({ a: "é" }), "utf8"));
  });

  test("rejects ISR views at or above 1.50 MiB", () => {
    const oversized = "x".repeat(MAX_DATA_CACHE_JSON_BYTES);
    expect(() => assertPublishedViewJsonSize("categories/assignments/shards/0.json", oversized)).toThrow(
      /1\.50 MiB Data Cache budget/,
    );
  });

  test("accepts a small assignments index", () => {
    expect(() =>
      assertPublishedViewJsonSize("categories/assignments.json", {
        schema_version: 2,
        rules_version: "2026-06-05.1",
        generated_at: "2026-06-05T00:00:00.000Z",
        shard_count: 32,
      }),
    ).not.toThrow();
  });

  test("does not apply the Data Cache budget to search/index.json", () => {
    const oversized = "x".repeat(MAX_DATA_CACHE_JSON_BYTES);
    expect(() => assertPublishedViewJsonSize("search/index.json", oversized)).not.toThrow();
  });
});
