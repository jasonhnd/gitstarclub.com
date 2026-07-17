import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import { invalidatePublishedVersionMemo, readView } from "./source";
import { PUBLISHED_VIEWS_CACHE_TAG } from "./publication-cache-contract";

// Route a mocked global fetch by URL to simulate pointer + view fetches.
// Date.now() is driven forward past the 1h TTL between scenarios to invalidate
// the publish-pointer memo without reloading modules.
const BLOB = "https://blob.example.com";
const originalBase = process.env.BLOB_BASE_URL;
const originalPublicBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;

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
let fetchInits: Array<RequestInit & { next?: { revalidate?: number; tags?: string[] } }> = [];

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
  fetchInits = [];
  process.env.BLOB_BASE_URL = BLOB;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  advancePastTtl(); // ensure each test starts with an expired version memo
  Date.now = () => clock;
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);
    fetchInits.push((init ?? {}) as RequestInit & { next?: { revalidate?: number; tags?: string[] } });
    return Promise.resolve(makeRes(routeFor(url)));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  if (originalBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBase;
  if (originalPublicBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBase;
});

describe("readView — runtime Blob config", () => {
  test("uses BLOB_BASE_URL changes made after source.ts is imported", async () => {
    process.env.BLOB_BASE_URL = "https://blob-one.example.com";
    routes = {
      "/views/latest.json": { status: 200, json: { version: "v1" } },
      "/views/v1/data/runtime.json": { status: 200, json: { ok: true, tag: "one" } },
    };

    expect(await readView("data/runtime.json", Doc, { base: true })).toEqual({ ok: true, tag: "one" });

    process.env.BLOB_BASE_URL = "https://blob-two.example.com";
    routes = {
      "/views/latest.json": { status: 200, json: { version: "v2" } },
      "/views/v2/data/runtime.json": { status: 200, json: { ok: true, tag: "two" } },
    };

    expect(await readView("data/runtime.json", Doc, { base: true })).toEqual({ ok: true, tag: "two" });
    expect(fetchCalls.some((url) => url.startsWith("https://blob-two.example.com/views/latest.json"))).toBe(true);
  });

  test("falls back to NEXT_PUBLIC_BLOB_BASE_URL at call time", async () => {
    delete process.env.BLOB_BASE_URL;
    process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://public-blob.example.com/";
    routes = {
      "/flat/runtime.json": { status: 200, json: { ok: true, tag: "public" } },
    };

    expect(await readView("flat/runtime.json", Doc)).toEqual({ ok: true, tag: "public" });
    expect(fetchCalls[0]?.startsWith("https://public-blob.example.com/flat/runtime.json")).toBe(true);
  });

  test("throws before fetching when no Blob base is configured", async () => {
    delete process.env.BLOB_BASE_URL;
    delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;

    await expect(readView("flat/runtime.json", Doc)).rejects.toThrow("BLOB_BASE_URL not set");

    expect(fetchCalls).toEqual([]);
  });
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
    const pointerCall = fetchCalls.findIndex((u) => u.includes("/views/latest.json"));
    expect(fetchInits[pointerCall]?.next?.tags).toContain(PUBLISHED_VIEWS_CACHE_TAG);
  });

  test("a warmed pointer memo can be invalidated immediately after publication", async () => {
    routes = {
      "/views/latest.json": { status: 200, json: { version: "v1" } },
      "/views/v1/data/warm.json": { status: 200, json: { ok: true, tag: "one" } },
    };
    expect(await readView("data/warm.json", Doc, { base: true })).toEqual({ ok: true, tag: "one" });

    routes = {
      "/views/latest.json": { status: 200, json: { version: "v2" } },
      "/views/v2/data/warm.json": { status: 200, json: { ok: true, tag: "two" } },
    };
    invalidatePublishedVersionMemo();

    expect(await readView("data/warm.json", Doc, { base: true })).toEqual({ ok: true, tag: "two" });
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

  test("falls back to flat <path> when the pointer stalls past the timeout", async () => {
    advancePastTtl();
    routes = { "/data/pointer-timeout.json": { status: 200, json: { ok: true, tag: "flat-after-timeout" } } };
    let pointerSignal: AbortSignal | undefined;

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.includes("/views/latest.json")) {
        pointerSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      }
      return Promise.resolve(makeRes(routeFor(url)));
    }) as unknown as typeof fetch;

    const result = await readView("data/pointer-timeout.json", Doc, { base: true, timeoutMs: 5 });

    expect(result).toEqual({ ok: true, tag: "flat-after-timeout" });
    expect(pointerSignal?.aborted).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/data/pointer-timeout.json") && !u.includes("/views/"))).toBe(true);
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

  test("bypasses caches for mutable canonical, ops, and pointer artifacts", async () => {
    routes = {
      "/canonical/v2/meta.json": { status: 200, json: { ok: true, tag: "canonical" } },
      "/ops/workflows/run/manifest.json": { status: 200, json: { ok: true, tag: "ops" } },
      "/views/latest.json": { status: 200, json: { ok: true, tag: "pointer" } },
      "/views/run/meta.json": { status: 200, json: { ok: true, tag: "immutable" } },
    };

    await readView("canonical/v2/meta.json", Doc);
    await readView("ops/workflows/run/manifest.json", Doc);
    await readView("views/latest.json", Doc);
    await readView("views/run/meta.json", Doc);

    expect(fetchInits.slice(0, 3).map((init) => init.cache)).toEqual(["no-store", "no-store", "no-store"]);
    expect(fetchInits[3]?.cache).toBe("force-cache");
  });

  test("observes a canonical write in the same run while immutable views stay cacheable", async () => {
    const backing = new Map<string, FakeRoute>([
      ["/canonical/v2/state.json", { json: { ok: true, tag: "canonical-before" } }],
      ["/views/run/state.json", { json: { ok: true, tag: "view-before" } }],
    ]);
    const simulatedDataCache = new Map<string, FakeRoute>();
    const requestedUrls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);
      const path = new URL(url).pathname;
      const cached = simulatedDataCache.get(path);
      if (init?.cache === "force-cache" && cached) return Promise.resolve(makeRes(cached));
      const route = backing.get(path) ?? { status: 404 };
      if (init?.cache === "force-cache") simulatedDataCache.set(path, structuredClone(route));
      return Promise.resolve(makeRes(route));
    }) as unknown as typeof fetch;

    expect(await readView("canonical/v2/state.json", Doc)).toEqual({ ok: true, tag: "canonical-before" });
    expect(await readView("views/run/state.json", Doc)).toEqual({ ok: true, tag: "view-before" });

    backing.set("/canonical/v2/state.json", { json: { ok: true, tag: "canonical-after" } });
    backing.set("/views/run/state.json", { json: { ok: true, tag: "view-after" } });

    expect(await readView("canonical/v2/state.json", Doc)).toEqual({ ok: true, tag: "canonical-after" });
    expect(await readView("views/run/state.json", Doc)).toEqual({ ok: true, tag: "view-before" });
    expect(requestedUrls[0]).not.toBe(requestedUrls[2]);
  });

  test("aborts stalled flat reads and surfaces a timeout after retries", async () => {
    advancePastTtl();
    const signals: AbortSignal[] = [];

    globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    }) as unknown as typeof fetch;

    await expect(readView("live/stalled.json", Doc, { timeoutMs: 5 })).rejects.toThrow("view fetch live/stalled.json -> timeout after 5ms");

    expect(fetchCalls).toHaveLength(3);
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
