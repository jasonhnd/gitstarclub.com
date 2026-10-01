// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { afterEach, describe, expect, test } from "bun:test";
import {
  GITHUB_MAX_RETRIES,
  batchMetadata,
  retryDelayMs,
  searchWhitelist,
  secondaryLimitDelayMs,
} from "./github.mjs";

const originalFetch = globalThis.fetch;
const originalToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

function blockRealFetch() {
  globalThis.fetch = () => {
    throw new Error("real fetch");
  };
}

function response(status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(payload, { status, headers });
}

function scripted(responses) {
  const calls = [];
  const sleeps = [];
  const fetcher = async (input) => {
    calls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error(`unexpected extra fetch ${String(input)}`);
    return next;
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
  };
  return { calls, sleeps, opts: { fetcher, sleep, timeoutMs: 1_000 } };
}

const repo = {
  databaseId: 7,
  nameWithOwner: "acme/widget",
  owner: { login: "acme", __typename: "Organization" },
  name: "widget",
  description: null,
  primaryLanguage: null,
  repositoryTopics: { nodes: [] },
  createdAt: "2020-01-01T00:00:00Z",
  stargazerCount: 12,
  isArchived: false,
};

function searchItem(stars = 20) {
  return {
    id: 7,
    node_id: "NODE",
    full_name: "acme/widget",
    name: "widget",
    stargazers_count: stars,
    owner: { login: "acme" },
  };
}

function headersResponse(status, body, headers) {
  return response(status, body, headers);
}

describe("pipeline GitHub retry policy", () => {
  test("names a four-retry cap and ignores non-finite or oversized waits", () => {
    expect(GITHUB_MAX_RETRIES).toBe(4);
    expect(retryDelayMs(response(429, "", { "retry-after": "3" }), 1)).toBe(3_000);
    expect(retryDelayMs(response(429, "", { "retry-after": "120" }), 1)).toBe(60_000);
    expect(retryDelayMs(response(429, "", { "retry-after": "Infinity" }), 2)).toBe(2_000);
    expect(retryDelayMs(response(429, "", { "retry-after": "nope" }), 2)).toBe(2_000);
    expect(retryDelayMs(response(500, ""), 1)).toBe(1_000);
    expect(retryDelayMs(response(500, ""), 10)).toBe(30_000);

    const farReset = String(Math.floor(Date.now() / 1000) + 100_000);
    expect(retryDelayMs(response(429, "", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": farReset }), 1)).toBe(60_000);
    expect(retryDelayMs(response(429, "", { "x-ratelimit-remaining": "10", "x-ratelimit-reset": farReset }), 1)).toBe(1_000);
    expect(secondaryLimitDelayMs(403, "You have exceeded a secondary rate limit")).toBe(60_000);
    expect(secondaryLimitDelayMs(403, "Bad credentials")).toBeNull();
    expect(secondaryLimitDelayMs(429, "secondary rate limit")).toBeNull();
  });
});

describe("pipeline GitHub client (injected fetch)", () => {
  test("fails before any request when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN;
    blockRealFetch();
    const transport = scripted([]);
    await expect(batchMetadata(["NODE"], transport.opts)).rejects.toThrow("GITHUB_TOKEN not set");
    expect(transport.calls).toEqual([]);
  });

  test("rejects HTTP 400 and 401 before parsing a GraphQL body", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    for (const status of [400, 401]) {
      const transport = scripted([response(status, { message: `status ${status}` })]);
      await expect(batchMetadata(["NODE"], transport.opts)).rejects.toThrow(`GitHub GraphQL ${status}:`);
      expect(transport.calls).toHaveLength(1);
      expect(transport.sleeps).toEqual([]);
    }
  });

  test("bounds a long HTTP 400 diagnostic", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted([response(400, "x".repeat(500))]);
    const error = await batchMetadata(["NODE"], transport.opts).then(
      () => {
        throw new Error("expected HTTP 400");
      },
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(`GitHub GraphQL 400: ${"x".repeat(200)}`);
    expect(error.message).not.toContain("x".repeat(201));
  });

  test("retries a non-rate-limit 403 with backoff and then keeps the status", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted(Array.from({ length: 5 }, () => response(403, "Bad credentials")));
    await expect(batchMetadata(["NODE"], transport.opts)).rejects.toThrow("GitHub GraphQL 403: Bad credentials");
    expect(transport.calls).toHaveLength(5);
    expect(transport.sleeps).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  test("waits 60s on a secondary rate limit and then accepts the next payload", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted([
      response(403, "You have exceeded a secondary rate limit"),
      response(200, { data: { nodes: [repo] } }),
    ]);
    const rows = await batchMetadata(["NODE"], transport.opts);
    expect(transport.sleeps).toEqual([60_000]);
    expect(rows.get(7)?.current_stars).toBe(12);
    expect(rows.get(7)?.owner_type).toBe("Organization");
  });

  test("caps Retry-After at 60s and ignores a non-finite Retry-After", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const capped = scripted([
      headersResponse(429, "slow down", { "retry-after": "120" }),
      response(200, { data: { nodes: [] } }),
    ]);
    await expect(batchMetadata(["NODE"], capped.opts)).resolves.toEqual(new Map());
    expect(capped.sleeps).toEqual([60_000]);

    const ignored = scripted([
      headersResponse(429, "slow down", { "retry-after": "Infinity" }),
      response(200, { data: { nodes: [null] } }),
    ]);
    await expect(batchMetadata(["NODE"], ignored.opts)).resolves.toEqual(new Map());
    expect(ignored.sleeps).toEqual([1_000]);
  });

  test("uses reset only when remaining is zero, and caps that wait at 60s", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const farReset = String(Math.floor(Date.now() / 1000) + 100_000);
    const capped = scripted([
      headersResponse(429, "limited", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": farReset }),
      response(200, { data: { nodes: [] } }),
    ]);
    await batchMetadata(["NODE"], capped.opts);
    expect(capped.sleeps).toEqual([60_000]);

    const skipped = scripted([
      headersResponse(429, "limited", { "x-ratelimit-remaining": "10", "x-ratelimit-reset": farReset }),
      response(200, { data: { nodes: [] } }),
    ]);
    await batchMetadata(["NODE"], skipped.opts);
    expect(skipped.sleeps).toEqual([1_000]);
  });

  test("exhausts a GraphQL 5xx after five attempts and keeps the status", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted(Array.from({ length: 5 }, () => response(503, "unavailable")));
    await expect(batchMetadata(["NODE"], transport.opts)).rejects.toThrow("GitHub GraphQL 503: unavailable");
    expect(transport.calls).toHaveLength(GITHUB_MAX_RETRIES + 1);
    expect(transport.sleeps).toHaveLength(GITHUB_MAX_RETRIES);
  });

  test("rejects invalid GraphQL data instead of walking nodes", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const cases = [
      [response(200, "not-json"), /GitHub GraphQL invalid data: not-json/],
      [response(200, { data: null }), /GitHub GraphQL invalid data: null/],
      [response(200, { errors: [{ message: "nope" }] }), /GraphQL errors:/],
      [response(200, { data: {} }), /nodes must be an array/],
      [response(200, { data: { nodes: "nope" } }), /nodes must be an array/],
      [response(200, { data: { nodes: ["nope"] } }), /node was not an object/],
    ];
    for (const [body, pattern] of cases) {
      const transport = scripted([body]);
      await expect(batchMetadata(["NODE"], transport.opts)).rejects.toThrow(pattern);
      expect(transport.calls).toHaveLength(1);
      expect(transport.sleeps).toEqual([]);
    }
  });

  test("accepts valid empty GraphQL nodes and an empty id list", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const emptyNodes = scripted([response(200, { data: { nodes: [] } })]);
    await expect(batchMetadata(["NODE"], emptyNodes.opts)).resolves.toEqual(new Map());

    const nullNode = scripted([response(200, { data: { nodes: [null] } })]);
    await expect(batchMetadata(["NODE"], nullNode.opts)).resolves.toEqual(new Map());

    const noIds = scripted([]);
    await expect(batchMetadata([], noIds.opts)).resolves.toEqual(new Map());
    expect(noIds.calls).toEqual([]);
  });

  test("rejects Search 400 and 401 without a retry", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    for (const status of [400, 401]) {
      const transport = scripted([response(status, { message: "no" })]);
      await expect(searchWhitelist(10, 10, transport.opts)).rejects.toThrow(`GitHub REST ${status} /search/repositories:`);
      expect(transport.calls).toHaveLength(1);
      expect(transport.sleeps).toEqual([]);
    }
  });

  test("retries Search 403 and 5xx and then surfaces the last status", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    for (const status of [403, 500, 502]) {
      const transport = scripted(Array.from({ length: 5 }, () => response(status, `status ${status}`)));
      await expect(searchWhitelist(10, 10, transport.opts)).rejects.toThrow(`GitHub REST ${status} /search/repositories:`);
      expect(transport.calls).toHaveLength(5);
      expect(transport.sleeps).toEqual([1_000, 2_000, 4_000, 8_000]);
    }
  });

  test("returns an empty whitelist for valid empty Search data", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const discovered = scripted([response(200, { total_count: 0 })]);
    await expect(searchWhitelist(10, undefined, discovered.opts)).resolves.toEqual([]);
    expect(discovered.calls).toHaveLength(1);

    const ranged = scripted([response(200, { total_count: 0, items: [] })]);
    await expect(searchWhitelist(10, 10, ranged.opts)).resolves.toEqual([]);
  });

  test("rejects a Search page whose items are not an array", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted([response(200, { total_count: 1, items: {} })]);
    await expect(searchWhitelist(10, 10, transport.opts)).rejects.toThrow("items must be an array");
    expect(transport.calls).toHaveLength(1);
  });

  test("maps one successful Search page through the injected fetcher", async () => {
    process.env.GITHUB_TOKEN = "test-token";
    blockRealFetch();
    const transport = scripted([response(200, { total_count: 1, items: [searchItem(42)] })]);
    await expect(searchWhitelist(10, 42, transport.opts)).resolves.toEqual([
      {
        id: 7,
        node_id: "NODE",
        full_name: "acme/widget",
        owner: "acme",
        name: "widget",
        stars: 42,
      },
    ]);
    expect(transport.sleeps).toEqual([]);
  });
});
