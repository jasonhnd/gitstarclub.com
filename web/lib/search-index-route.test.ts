import { test, expect, describe, mock } from "bun:test";
import type { SearchIndex } from "@/lib/contracts";
import {
  SEARCH_INDEX_FAIL_CACHE,
  SEARCH_INDEX_HIT_CACHE,
  SEARCH_INDEX_MISS_CACHE,
  buildSearchIndexResponse,
} from "./search-index-response";

// Route-level coverage for GET /search-index response builder (issue #283).
// Tests the pure handler so the shared Bun process never needs mock.module on @/lib/data.

const SAMPLE: SearchIndex = {
  generated_at: "2026-06-21T06:00:05.520Z",
  count: 1,
  repos: [
    {
      id: 1,
      full_name: "hummingbot/hummingbot",
      owner: "hummingbot",
      language: "Python",
      current_stars: 18943,
      description: "x".repeat(200),
    },
  ],
};

describe("buildSearchIndexResponse", () => {
  test("returns slim 200 index when the view is present", async () => {
    const res = await buildSearchIndexResponse(async () => SAMPLE);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(SEARCH_INDEX_HIT_CACHE);
    const body = (await res.json()) as SearchIndex;
    expect(body.count).toBe(1);
    expect(body.repos[0].full_name).toBe("hummingbot/hummingbot");
    expect(body.repos[0].description?.length).toBe(96);
  });

  test("returns empty bootstrap payload when the view is absent", async () => {
    const res = await buildSearchIndexResponse(async () => null);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(SEARCH_INDEX_MISS_CACHE);
    await expect(res.json()).resolves.toEqual({ generated_at: "", count: 0, repos: [] });
  });

  test("returns structured 503 with no-store when the loader throws", async () => {
    const errSpy = mock(() => {});
    const originalError = console.error;
    console.error = errSpy as unknown as typeof console.error;
    try {
      const res = await buildSearchIndexResponse(async () => {
        throw new Error("view fetch search/index.json -> 500");
      });
      expect(res.status).toBe(503);
      expect(res.headers.get("Cache-Control")).toBe(SEARCH_INDEX_FAIL_CACHE);
      await expect(res.json()).resolves.toEqual({
        error: "search_index_unavailable",
        retryable: true,
      });
      expect(errSpy).toHaveBeenCalled();
    } finally {
      console.error = originalError;
    }
  });
});
