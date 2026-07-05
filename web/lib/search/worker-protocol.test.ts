import { describe, expect, test } from "bun:test";
import {
  createSearchWorkerError,
  parseSearchIndexPayload,
  parseSearchWorkerRepos,
  type SearchWorkerOutMessage,
} from "./worker-protocol";

const repo = {
  id: 1,
  full_name: "facebook/react",
  owner: "facebook",
  language: "JavaScript",
  current_stars: 230000,
  description: "A declarative JavaScript library for building user interfaces.",
};

describe("search worker protocol", () => {
  test("accepts the empty bootstrap search-index payload", () => {
    const parsed = parseSearchIndexPayload({ generated_at: "", count: 0, repos: [] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.repos).toEqual([]);
  });

  test("rejects malformed search-index payloads with a structured error", () => {
    const parsed = parseSearchIndexPayload({ generated_at: "2026-07-05T00:00:00.000Z", count: 2, repos: [repo] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("bad-index");
      expect(parsed.error.message).toBe("Search index data is malformed.");
    }
  });

  test("rejects bad worker init repos with a structured error", () => {
    const parsed = parseSearchWorkerRepos([{ ...repo, id: -1 }]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("bad-index");
  });

  test("worker exceptions can be posted as structured error messages", () => {
    const message: SearchWorkerOutMessage = {
      type: "error",
      id: 7,
      error: createSearchWorkerError("worker-query", new Error("MiniSearch exploded")),
    };

    expect(message).toMatchObject({
      type: "error",
      id: 7,
      error: { code: "worker-query", message: "Search query failed." },
    });
  });
});
