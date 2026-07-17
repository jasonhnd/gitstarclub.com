import { describe, expect, test } from "bun:test";
import type { SearchIndexFetch } from "./index-fetch";
import { fetchSearchIndex } from "./index-fetch";

const repo = {
  id: 1,
  full_name: "facebook/react",
  owner: "facebook",
  language: "JavaScript",
  current_stars: 232_000,
  description: "A UI library",
};

describe("fetchSearchIndex", () => {
  test("uses browser revalidation by default", async () => {
    const fetchImpl: SearchIndexFetch = async (input, init) => {
      expect(input).toBe("/search-index");
      expect(init.cache).toBe("no-cache");
      return Response.json({ count: 1, repos: [repo] });
    };

    const result = await fetchSearchIndex({ fetchImpl });

    expect(result).toEqual({ ok: true, repos: [repo] });
  });

  test("a reload retry recovers from a cached malformed response", async () => {
    const caches: Array<RequestCache | undefined> = [];
    const fetchImpl: SearchIndexFetch = async (_input, init) => {
      caches.push(init.cache);
      return caches.length === 1
        ? Response.json({ count: 2, repos: [repo] })
        : Response.json({ count: 1, repos: [repo] });
    };

    const first = await fetchSearchIndex({ fetchImpl });
    const second = await fetchSearchIndex({ fetchImpl, cache: "reload" });

    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("expected malformed index failure");
    expect(first.error.code).toBe("bad-index");
    expect(second).toEqual({ ok: true, repos: [repo] });
    expect(caches).toEqual(["no-cache", "reload"]);
  });

  test("passes AbortSignal through and does not convert cancellation into a load error", async () => {
    const controller = new AbortController();
    const abortError = new DOMException("cancelled", "AbortError");
    const fetchImpl: SearchIndexFetch = async (_input, init) => {
      expect(init.signal).toBe(controller.signal);
      throw abortError;
    };
    controller.abort();

    await expect(fetchSearchIndex({ fetchImpl, signal: controller.signal })).rejects.toBe(abortError);
  });
});
