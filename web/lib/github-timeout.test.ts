import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const originalToken = process.env.GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;
const { fetchStarCounts } = await import("./github");

const originalFetch = globalThis.fetch;
let requestSignal: AbortSignal | undefined;
let fetchCalls = 0;

beforeEach(() => {
  requestSignal = undefined;
  fetchCalls = 0;
  delete process.env.GITHUB_TOKEN;
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

describe("GitHub fetch timeouts", () => {
  test("throws before fetching when GITHUB_TOKEN is missing", async () => {
    await expect(fetchStarCounts([{ id: 1, owner: "owner", name: "repo" }])).rejects.toThrow("GITHUB_TOKEN not set");

    expect(fetchCalls).toBe(0);
  });

  test("uses GITHUB_TOKEN changes made after github.ts is imported", async () => {
    let authorization: string | undefined;
    process.env.GITHUB_TOKEN = "runtime-token";
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return Promise.resolve(new Response(JSON.stringify({ data: { r0: { stargazerCount: 42 } } }), { status: 200 }));
    }) as unknown as typeof fetch;

    const result = await fetchStarCounts([{ id: 1, owner: "owner", name: "repo" }]);

    expect(result.get(1)).toBe(42);
    expect(authorization).toBe("bearer runtime-token");
    expect(fetchCalls).toBe(1);
  });

  test("aborts a stalled GraphQL star-count request", async () => {
    process.env.GITHUB_TOKEN = "test-token";

    await expect(
      fetchStarCounts([{ id: 1, owner: "owner", name: "repo" }], 100, { timeoutMs: 5 }),
    ).rejects.toThrow("fetch timed out after 5ms");

    expect(requestSignal?.aborted).toBe(true);
  });
});
