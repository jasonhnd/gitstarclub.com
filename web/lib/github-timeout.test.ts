import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const originalToken = process.env.GITHUB_TOKEN;
process.env.GITHUB_TOKEN = "test-token";
const { fetchStarCounts } = await import("./github");
if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
else process.env.GITHUB_TOKEN = originalToken;

const originalFetch = globalThis.fetch;
let requestSignal: AbortSignal | undefined;

beforeEach(() => {
  requestSignal = undefined;
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GitHub fetch timeouts", () => {
  test("aborts a stalled GraphQL star-count request", async () => {
    await expect(
      fetchStarCounts([{ id: 1, owner: "owner", name: "repo" }], 100, { timeoutMs: 5 }),
    ).rejects.toThrow("fetch timed out after 5ms");

    expect(requestSignal?.aborted).toBe(true);
  });
});
