import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { z } from "zod";

// source.ts reads BLOB_BASE_URL at module-load time and memoises the published version
// (views/latest.json) for 1h at module scope. So we must (1) set the env BEFORE importing
// the SUT, and (2) drive Date.now() forward past the 1h TTL to invalidate the version memo
// between scenarios. We route a mocked global fetch by URL to simulate pointer + view fetches.

// MUST equal the base set in rank.test.ts: source.ts captures BLOB_BASE once at load, and
// whichever test file loads source.ts first wins for the whole process. Using ??= + the same
// value keeps the full lib/data/ suite order-independent (assertions below build on this base).
const BLOB = "https://blob.example.com";
process.env.BLOB_BASE_URL ??= BLOB;
// Guard: NEXT_PUBLIC fallback must not shadow the primary base in this test.
delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;

// Import AFTER env is set so BLOB_BASE captures our test base.
const { readView } = await import("./source");

const Doc = z.object({ ok: z.boolean(), tag: z.string() });

const realFetch = globalThis.fetch;
const realNow = Date.now;

let clock = 1_000_000;
const advancePastTtl = () => {
  clock += 3_700_000; // > VERSION_TTL_MS (1h) → version memo expires
};

interface FakeRoute {
  status?: number;
  json?: unknown;
}
// Map of exact-or-prefix URL (path portion, query stripped) → response.
let routes: Record<string, FakeRoute> = {};
let fetchCalls: string[] = [];

const makeRes = (route: FakeRoute): Response =>
  ({
    ok: (route.status ?? 200) >= 200 && (route.status ?? 200) < 300,
    status: route.status ?? 200,
    json: async () => route.json,
  }) as unknown as Response;

function routeFor(url: string): FakeRoute {
  const noQuery = url.split("?")[0];
  // Longest-prefix match keeps versioned vs flat paths unambiguous.
  const key = Object.keys(routes)
    .filter((k) => noQuery.endsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? routes[key] : { status: 404 };
}

beforeEach(() => {
  routes = {};
  fetchCalls = [];
  advancePastTtl(); // ensure each test starts with an expired version memo
  Date.now = () => clock;
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);
    return Promise.resolve(makeRes(routeFor(url)));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

describe("readView — base:true version-prefix resolution", () => {
  test("resolves views/latest.json then reads views/<version>/<path>", async () => {
    routes = {
      "/views/latest.json": { status: 200, json: { version: "v42" } },
      "/views/v42/rank/week/2026-W23/repo/flow.json": { status: 200, json: { ok: true, tag: "versioned" } },
    };

    const result = await readView("rank/week/2026-W23/repo/flow.json", Doc, { base: true });

    expect(result).toEqual({ ok: true, tag: "versioned" });
    // It fetched the pointer and the versioned key (NOT the flat path).
    expect(fetchCalls.some((u) => u.includes("/views/latest.json"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/views/v42/rank/week/2026-W23/repo/flow.json"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/rank/week/2026-W23/repo/flow.json") && !u.includes("/views/"))).toBe(false);
  });

  test("falls back to flat <path> when the pointer 404s (no version)", async () => {
    advancePastTtl();
    routes = {
      "/views/latest.json": { status: 404 },
      "/rank/month/2026-05/org/stock.json": { status: 200, json: { ok: true, tag: "flat" } },
    };

    const result = await readView("rank/month/2026-05/org/stock.json", Doc, { base: true });

    expect(result).toEqual({ ok: true, tag: "flat" });
    // Flat key was read; no versioned views/<version>/ path was attempted.
    expect(fetchCalls.some((u) => u.includes("/rank/month/2026-05/org/stock.json"))).toBe(true);
    expect(fetchCalls.some((u) => /\/views\/[^/]+\/rank\//.test(u))).toBe(false);
  });

  test("falls back to flat <path> when the pointer is unreachable (fetch throws)", async () => {
    advancePastTtl();
    routes = { "/data/whatever.json": { status: 200, json: { ok: true, tag: "flat-after-throw" } } };
    // Throw only for the pointer; succeed for the flat view.
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.includes("/views/latest.json")) return Promise.reject(new Error("network down"));
      return Promise.resolve(makeRes(routeFor(url)));
    }) as unknown as typeof fetch;

    const result = await readView("data/whatever.json", Doc, { base: true });

    expect(result).toEqual({ ok: true, tag: "flat-after-throw" });
    expect(fetchCalls.some((u) => u.includes("/data/whatever.json") && !u.includes("/views/"))).toBe(true);
  });

  test("returns null when the resolved base view itself is 404", async () => {
    advancePastTtl();
    routes = {
      "/views/latest.json": { status: 200, json: { version: "v7" } },
      // versioned view absent → rawRead returns null → readView returns null
    };

    const result = await readView("rank/week/2099-W01/repo/flow.json", Doc, { base: true });

    expect(result).toBeNull();
  });
});

describe("readView — non-base (flat) reads", () => {
  test("base:false reads the flat path directly and never touches the pointer", async () => {
    advancePastTtl();
    routes = {
      "/live/rank/week/2026-W23/repo/flow.json": { status: 200, json: { ok: true, tag: "live" } },
      "/views/latest.json": { status: 200, json: { version: "vX" } },
    };

    const result = await readView("live/rank/week/2026-W23/repo/flow.json", Doc, { bust: "2026-06-03" });

    expect(result).toEqual({ ok: true, tag: "live" });
    // No pointer resolution for non-base reads.
    expect(fetchCalls.some((u) => u.includes("/views/latest.json"))).toBe(false);
    // bust token is appended as a query param.
    expect(fetchCalls.some((u) => u.includes("/live/rank/week/2026-W23/repo/flow.json?v=2026-06-03"))).toBe(true);
  });

  test("returns null when a flat view is 404", async () => {
    advancePastTtl();
    routes = {};
    const result = await readView("live/rank/week/2099-W01/repo/flow.json", Doc);
    expect(result).toBeNull();
  });
});
