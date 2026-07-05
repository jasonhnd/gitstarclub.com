import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fetchStarCounts } from "./github";

const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;
const fetchCalls: string[] = [];

beforeEach(() => {
  fetchCalls.length = 0;
  process.env.GITHUB_TOKEN = "token-one";
  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    fetchCalls.push(String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ""));
    return new Response(JSON.stringify({ data: { r0: { stargazerCount: 123 } } }), { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

describe("GitHub runtime config", () => {
  test("uses the current GitHub token without re-importing", async () => {
    const refs = [{ id: 1, owner: "owner", name: "repo" }];

    await expect(fetchStarCounts(refs)).resolves.toEqual(new Map([[1, 123]]));
    process.env.GITHUB_TOKEN = "token-two";
    await expect(fetchStarCounts(refs)).resolves.toEqual(new Map([[1, 123]]));

    expect(fetchCalls).toEqual(["bearer token-one", "bearer token-two"]);
  });

  test("fails before fetching when the GitHub token is missing", async () => {
    delete process.env.GITHUB_TOKEN;

    await expect(fetchStarCounts([{ id: 1, owner: "owner", name: "repo" }])).rejects.toThrow("GITHUB_TOKEN not set");
    expect(fetchCalls).toHaveLength(0);
  });
});
