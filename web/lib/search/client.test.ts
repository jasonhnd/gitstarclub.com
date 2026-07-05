import { describe, expect, test } from "bun:test";
import { parseSearchIndexPayload, searchWorkerError } from "./client";

describe("parseSearchIndexPayload", () => {
  test("accepts a well-formed search index payload", () => {
    const result = parseSearchIndexPayload({
      generated_at: "2026-07-05T00:00:00Z",
      count: 1,
      repos: [{ id: 1, full_name: "facebook/react", owner: "facebook", language: null, current_stars: 250000, description: null }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repos[0].full_name).toBe("facebook/react");
  });

  test("rejects a bad-index payload with no repos array", () => {
    const result = parseSearchIndexPayload({ count: 0, repos: {} });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("repos[]");
  });

  test("rejects a count mismatch", () => {
    const result = parseSearchIndexPayload({
      count: 2,
      repos: [{ id: 1, full_name: "facebook/react", owner: "facebook", current_stars: 250000 }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("count");
  });
});

describe("searchWorkerError", () => {
  test("posts structured worker error details", () => {
    expect(searchWorkerError("query-failed", new Error("boom"), 7)).toEqual({
      type: "error",
      id: 7,
      reason: "query-failed",
      message: "boom",
    });
  });
});
