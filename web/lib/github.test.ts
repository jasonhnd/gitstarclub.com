// Unit tests for web/lib/github.ts. Pure helpers are the exported functions.
// HTTP policy goes through fetchStarCounts, fetchRepositoryMetadata, and
// githubRepositorySearch with an injected fetcher. No test calls api.github.com.
import { afterEach, describe, expect, test } from "bun:test";
import { FetchTimeoutError } from "./fetch-timeout.mjs";
import {
  GITHUB_ACCEPT,
  GITHUB_MAX_RETRIES,
  GITHUB_SEARCH_MAX_PAGES,
  GITHUB_SEARCH_PAGE_SIZE,
  GITHUB_USER_AGENT,
  GitHubHttpError,
  githubApiHeaders,
  githubRepositorySearch,
  isTransientGithubError,
  isTransientGithubStatus,
  retryDelayMs,
  searchWhitelistHop,
  searchWhitelistWithSearch,
  secondaryLimitDelayMs,
  fetchRepositoryMetadata,
  fetchStarCounts,
  type SearchResult,
} from "./github";

const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

function resWith(headers: Record<string, string>): Response {
  return new Response(null, { status: 200, headers });
}

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, { status, headers });
}

function scripted(responses: Response[]) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra fetch ${String(input)}`);
    return next;
  };
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { calls, sleeps, opts: { fetcher, sleep, timeoutMs: 1_000 } };
}

function blockRealFetch(): void {
  globalThis.fetch = (() => {
    throw new Error("real fetch");
  }) as unknown as typeof fetch;
}

const repo = { id: 1, owner: "acme", name: "widget" };

describe("secondaryLimitDelayMs (pure)", () => {
  test("returns null for any non-403 status", () => {
    expect(secondaryLimitDelayMs(200, "secondary rate limit")).toBeNull();
    expect(secondaryLimitDelayMs(429, "abuse detection")).toBeNull();
    expect(secondaryLimitDelayMs(500, "rate limit")).toBeNull();
  });

  test("returns 60s for a 403 mentioning a secondary/abuse/rate limit (case-insensitive)", () => {
    expect(secondaryLimitDelayMs(403, "You have exceeded a secondary rate limit")).toBe(60_000);
    expect(secondaryLimitDelayMs(403, "ABUSE DETECTION triggered")).toBe(60_000);
    expect(secondaryLimitDelayMs(403, "API rate limit exceeded")).toBe(60_000);
  });

  test("returns null for a 403 that is not a rate-limit message (e.g. plain forbidden)", () => {
    expect(secondaryLimitDelayMs(403, "Bad credentials")).toBeNull();
    expect(secondaryLimitDelayMs(403, "")).toBeNull();
  });
});

describe("retryDelayMs (pure)", () => {
  test("honours a positive Retry-After header (seconds → ms), capped at 60s", () => {
    expect(retryDelayMs(resWith({ "retry-after": "3" }), 1)).toBe(3000);
    expect(retryDelayMs(resWith({ "retry-after": "120" }), 1)).toBe(60_000);
  });

  test("ignores a non-positive / non-numeric Retry-After and falls through", () => {
    expect(retryDelayMs(resWith({ "retry-after": "0" }), 2)).toBe(2000);
    expect(retryDelayMs(resWith({ "retry-after": "nope" }), 2)).toBe(2000);
    expect(retryDelayMs(resWith({ "retry-after": "Infinity" }), 2)).toBe(2000);
  });

  test("waits until x-ratelimit-reset when remaining is 0 (+1s grace), capped at 60s", () => {
    const resetEpoch = Math.floor((Date.now() + 5000) / 1000);
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetEpoch) }), 1);
    expect(delay).toBeGreaterThan(4000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  test("clamps a past reset time to the +1s grace floor", () => {
    const pastEpoch = Math.floor((Date.now() - 10_000) / 1000);
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(pastEpoch) }), 1);
    expect(delay).toBe(1000);
  });

  test("does NOT use the reset branch when remaining > 0", () => {
    const resetEpoch = Math.floor((Date.now() + 60_000) / 1000);
    const delay = retryDelayMs(resWith({ "x-ratelimit-remaining": "10", "x-ratelimit-reset": String(resetEpoch) }), 1);
    expect(delay).toBe(1000);
  });

  test("exponential backoff by attempt, capped at 30s, when no rate headers present", () => {
    const noHeaders = () => resWith({});
    expect(retryDelayMs(noHeaders(), 1)).toBe(1000);
    expect(retryDelayMs(noHeaders(), 2)).toBe(2000);
    expect(retryDelayMs(noHeaders(), 3)).toBe(4000);
    expect(retryDelayMs(noHeaders(), 4)).toBe(8000);
    expect(retryDelayMs(noHeaders(), 10)).toBe(30_000);
  });
});

function searchRepo(stars: number, index: number) {
  return {
    id: index + 1,
    node_id: `R_${index + 1}`,
    full_name: `owner/repo-${index + 1}`,
    name: `repo-${index + 1}`,
    stargazers_count: stars,
    owner: { login: "owner" },
  };
}

describe("searchWhitelist star-range bucketing", () => {
  test("discovers 599,999, 600,000, 600,001 and >1m without a fixed upper ceiling", async () => {
    const repos = [599_999, 600_000, 600_001, 1_250_000].map(searchRepo);
    const queries: string[] = [];
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const q = String(params.q);
      queries.push(q);
      if (q === "stars:>=599999") return { total_count: repos.length, items: [repos.at(-1)!] };
      if (q === "stars:599999..1250000") return { total_count: repos.length, items: repos.toReversed() };
      throw new Error(`unexpected query ${q}`);
    };

    const result = await searchWhitelistWithSearch(599_999, search);

    expect(result.map((entry) => entry.stars)).toEqual([1_250_000, 600_001, 600_000, 599_999]);
    expect(queries).toEqual(["stars:>=599999", "stars:599999..1250000"]);
  });

  test("fails closed instead of publishing an incomplete Search membership", async () => {
    await expect(
      searchWhitelistWithSearch(10_000, async () => ({ total_count: 1, incomplete_results: true, items: [] })),
    ).rejects.toThrow("GitHub Search returned incomplete results");
  });

  test("splits a wide bucket at the floored midpoint with no gap or overlap", async () => {
    const queries: string[] = [];
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const q = String(params.q);
      queries.push(q);
      expect(params.per_page).toBe(GITHUB_SEARCH_PAGE_SIZE);
      if (q === "stars:10000..600000") return { total_count: 1001, items: [] };
      if (q === "stars:10000..305000" || q === "stars:305001..600000") return { total_count: 0, items: [] };
      throw new Error(`unexpected query ${q}`);
    };

    await expect(searchWhitelistWithSearch(10_000, search, 600_000)).resolves.toEqual([]);
    expect(queries).toEqual([
      "stars:10000..600000",
      "stars:305001..600000",
      "stars:10000..305000",
    ]);
  });

  test("a single-star bucket that cannot be split fails closed", async () => {
    const queries: string[] = [];
    await expect(
      searchWhitelistWithSearch(12_345, async (params) => {
        queries.push(String(params.q));
        return { total_count: 1001, items: [] };
      }, 12_345),
    ).rejects.toThrow("stars:12345..12345 has 1001 results and cannot be paged completely");
    expect(queries).toEqual(["stars:12345..12345"]);
  });

  test("midpoint splits shrink until every bucket is one star wide", async () => {
    const queries: string[] = [];
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const q = String(params.q);
      queries.push(q);
      const match = q.match(/^stars:(\d+)\.\.(\d+)$/);
      if (!match) throw new Error(`unexpected query ${q}`);
      const low = Number(match[1]);
      const high = Number(match[2]);
      return { total_count: high > low ? 1001 : 0, items: [] };
    };

    await expect(searchWhitelistWithSearch(10, search, 13)).resolves.toEqual([]);
    expect(queries).toContain("stars:10..10");
    expect(queries).toContain("stars:11..11");
    expect(queries).toContain("stars:12..12");
    expect(queries).toContain("stars:13..13");
    expect(queries.length).toBeLessThan(20);
  });

  test("pages one full bucket and stops at the named 10-page ceiling", async () => {
    expect(GITHUB_SEARCH_MAX_PAGES).toBe(10);
    expect(GITHUB_SEARCH_PAGE_SIZE).toBe(100);
    const pages: number[] = [];
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const page = Number(params.page);
      pages.push(page);
      return {
        total_count: 1_000,
        items: page === 1 ? [searchRepo(20, 0)] : [],
      };
    };

    const result = await searchWhitelistWithSearch(20, search, 20);
    expect(pages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result).toHaveLength(1);
  });

  test("a budgeted hop yields remaining star ranges and resumes to the same set", async () => {
    const repos = [12_000, 3_000, 1_500].map(searchRepo);
    let nowMs = 0;
    const search = async (params: Record<string, string | number>): Promise<SearchResult> => {
      const q = String(params.q);
      nowMs += 1_000;
      if (q === "stars:>=1000") return { total_count: 3, items: [repos[0]!] };
      if (q === "stars:1000..12000") return { total_count: 3, items: repos };
      throw new Error(`unexpected query ${q}`);
    };

    const first = await searchWhitelistHop({
      minStars: 1_000,
      search,
      budgetMs: 500,
      yieldSlackMs: 0,
      now: () => nowMs,
    });
    expect(first.done).toBe(false);
    expect(first.progress.queue).toEqual([{ low: 1_000, high: 12_000 }]);
    expect(first.entries).toEqual([]);

    const second = await searchWhitelistHop({
      minStars: 1_000,
      search,
      progress: first.progress,
      budgetMs: Number.POSITIVE_INFINITY,
      yieldSlackMs: 0,
      now: () => nowMs,
    });
    expect(second.done).toBe(true);
    expect(second.entries.map((entry) => entry.stars)).toEqual([12_000, 3_000, 1_500]);
    expect(await searchWhitelistWithSearch(1_000, search)).toEqual(second.entries);
  });

  test("whitelist entries dedup by id and sort by stars desc", async () => {
    const search = async (): Promise<SearchResult> => ({
      total_count: 3,
      items: [
        searchRepo(100, 0),
        searchRepo(500, 1),
        { ...searchRepo(100, 0) },
        searchRepo(300, 2),
      ],
    });

    const result = await searchWhitelistWithSearch(100, search, 500);
    expect(result.map((entry) => entry.id)).toEqual([2, 3, 1]);
    expect(result).toHaveLength(3);
  });
});

describe("githubApiHeaders (GraphQL + REST)", () => {
  test("sends User-Agent gitstarclub and the GitHub Accept header", () => {
    expect(GITHUB_USER_AGENT).toBe("gitstarclub");
    expect(GITHUB_ACCEPT).toBe("application/vnd.github+json");
    expect(githubApiHeaders("tok")).toEqual({
      Authorization: "bearer tok",
      Accept: GITHUB_ACCEPT,
      "User-Agent": GITHUB_USER_AGENT,
    });
  });

  test("GraphQL extras keep UA + Accept and add Content-Type", () => {
    const headers = githubApiHeaders("tok", { "Content-Type": "application/json" });
    expect(headers["User-Agent"]).toBe("gitstarclub");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("bearer tok");
  });
});

describe("isTransientGithubError", () => {
  test("treats 502/503/504/429 and fetch timeouts as transient", () => {
    expect(isTransientGithubStatus(502)).toBe(true);
    expect(isTransientGithubStatus(403)).toBe(false);
    expect(isTransientGithubError(new GitHubHttpError("graphql", 502, "error code: 502"))).toBe(true);
    expect(isTransientGithubError(new GitHubHttpError("search", 429, "rate limited"))).toBe(true);
    expect(isTransientGithubError(new GitHubHttpError("graphql", 401, "bad credentials"))).toBe(false);
    expect(isTransientGithubError(new FetchTimeoutError("https://api.github.com/graphql", 30_000))).toBe(true);
    expect(isTransientGithubError(new Error("GitHub GraphQL 502: error code: 502"))).toBe(true);
    expect(isTransientGithubError(new Error("GraphQL metadata missing for 1 active repository"))).toBe(false);
  });
});

describe("GitHub client retry policy (injected fetch)", () => {
  test("names four extra attempts", () => {
    expect(GITHUB_MAX_RETRIES).toBe(4);
  });

  test("rejects GraphQL 400 and 401 on the first response", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    for (const status of [400, 401]) {
      const transport = scripted([response(status, { message: `status ${status}` })]);
      const error = await fetchStarCounts([repo], 100, transport.opts).then(
        () => {
          throw new Error("expected HTTP error");
        },
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(GitHubHttpError);
      expect((error as GitHubHttpError).status).toBe(status);
      expect((error as GitHubHttpError).message).toContain(`status ${status}`);
      expect(transport.calls).toHaveLength(1);
      expect(transport.sleeps).toEqual([]);
    }
  });

  test("retries a plain 403 with backoff and stops after five attempts", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted(Array.from({ length: 5 }, () => response(403, "Bad credentials")));
    await expect(fetchStarCounts([repo], 100, transport.opts)).rejects.toThrow("GitHub GraphQL 403:");
    expect(transport.calls).toHaveLength(5);
    expect(transport.sleeps).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  test("waits 60s for a secondary rate limit, then reads the star count", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted([
      response(403, "You have exceeded a secondary rate limit"),
      response(200, { data: { r0: { stargazerCount: 9 } } }),
    ]);
    const counts = await fetchStarCounts([repo], 100, transport.opts);
    expect(transport.sleeps).toEqual([60_000]);
    expect(counts.get(1)).toBe(9);
  });

  test("caps Retry-After at 60s and ignores a non-finite value", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const capped = scripted([
      response(429, "slow down", { "retry-after": "120" }),
      response(200, { data: { r0: null } }),
    ]);
    await expect(fetchStarCounts([repo], 100, capped.opts)).resolves.toEqual(new Map());
    expect(capped.sleeps).toEqual([60_000]);

    const ignored = scripted([
      response(429, "slow down", { "retry-after": "Infinity" }),
      response(200, { data: { r0: null } }),
    ]);
    await expect(fetchStarCounts([repo], 100, ignored.opts)).resolves.toEqual(new Map());
    expect(ignored.sleeps).toEqual([1_000]);
  });

  test("exhausts GraphQL 5xx after five attempts", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted(Array.from({ length: 5 }, () => response(503, "unavailable")));
    const error = await fetchStarCounts([repo], 100, transport.opts).then(
      () => {
        throw new Error("expected exhaustion");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(GitHubHttpError);
    expect((error as GitHubHttpError).status).toBe(503);
    expect(transport.calls).toHaveLength(GITHUB_MAX_RETRIES + 1);
    expect(transport.sleeps).toHaveLength(GITHUB_MAX_RETRIES);
  });

  test("rejects invalid GraphQL data and accepts a valid empty repository", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const missingData = scripted([response(200, { errors: [{ message: "nope" }] })]);
    await expect(fetchStarCounts([repo], 100, missingData.opts)).rejects.toThrow(/GraphQL:/);
    expect(missingData.calls).toHaveLength(1);

    const badShape = scripted([response(200, { data: { r0: { stargazerCount: "many" } } })]);
    await expect(fetchStarCounts([repo], 100, badShape.opts)).rejects.toThrow();
    expect(badShape.sleeps).toEqual([]);

    const empty = scripted([response(200, { data: { r0: null } })]);
    await expect(fetchStarCounts([repo], 100, empty.opts)).resolves.toEqual(new Map());

    const badNodes = scripted([response(200, { data: { nodes: "nope" } })]);
    await expect(fetchRepositoryMetadata(["NODE"], badNodes.opts)).rejects.toThrow();

    const emptyNodes = scripted([response(200, { data: { nodes: [] } })]);
    await expect(fetchRepositoryMetadata(["NODE"], emptyNodes.opts)).resolves.toEqual(new Map());

    const nullNode = scripted([response(200, { data: { nodes: [null] } })]);
    await expect(fetchRepositoryMetadata(["NODE"], nullNode.opts)).resolves.toEqual(new Map());
  });

  test("rejects Search 400 and 401 and exhausts Search 429 and 5xx", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    for (const status of [400, 401]) {
      const transport = scripted([response(status, { message: "no" })]);
      const search = githubRepositorySearch(transport.opts);
      const error = await search({ q: "stars:>=1" }).then(
        () => {
          throw new Error("expected HTTP error");
        },
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(GitHubHttpError);
      expect((error as GitHubHttpError).status).toBe(status);
      expect((error as GitHubHttpError).source).toBe("search");
      expect(transport.calls).toHaveLength(1);
      expect(transport.sleeps).toEqual([]);
    }

    for (const status of [429, 500]) {
      const transport = scripted(Array.from({ length: 5 }, () => response(status, `status ${status}`)));
      const search = githubRepositorySearch(transport.opts);
      await expect(search({ q: "stars:>=1" })).rejects.toThrow(`GitHub Search ${status}:`);
      expect(transport.calls).toHaveLength(5);
    }
  });
});
