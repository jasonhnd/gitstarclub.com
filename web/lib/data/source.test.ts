import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { z } from "zod";
import {
  invalidatePublishedVersionMemo,
  readAuthoritativeView,
  readRequiredView,
  readView,
} from "./source";
import { PUBLISHED_VIEWS_CACHE_TAG } from "./publication-cache-contract";
import { resolveCanonicalBlobPath } from "./bootstrap-publication";
import { resetBootstrapPointerCacheForTests } from "./bootstrap-pointer-cache";
import { resetViewParseStateForTests } from "./parse-view";

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

function livePointer(generation: string, lease: unknown = null) {
  return {
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: "daily:2026-07-17",
    job: "daily",
    day: "2026-07-17",
    month: "2026-07",
    week: "2026-W29",
    published_at: "2026-07-17T03:00:00.000Z",
    previous_generation: null,
    lease,
  };
}

function liveManifest(generation: string, previousGeneration: string | null, files: string[]) {
  return {
    schema_ver: 1,
    generation,
    run_id: generation,
    idempotency_key: "daily:2026-07-17",
    job: "daily",
    day: "2026-07-17",
    month: "2026-07",
    week: "2026-W29",
    created_at: "2026-07-17T03:00:00.000Z",
    previous_generation: previousGeneration,
    files,
  };
}
// Map of exact-or-prefix URL (path portion, query stripped) → response.
let routes: Record<string, FakeRoute> = {};
let fetchCalls: string[] = [];
let fetchInits: Array<RequestInit & { next?: { revalidate?: number; tags?: string[] } }> = [];

const makeRes = (route: FakeRoute): Response =>
  ({
    ok: (route.status ?? 200) >= 200 && (route.status ?? 200) < 300,
    status: route.status ?? 200,
    headers: new Headers(),
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

const bootstrapPointer = (generation = "bootstrap-20260717T120000Z") => ({
  schema_ver: 1,
  generation,
  prefix: `bootstrap/generations/${generation}`,
  previous_generation: null,
  published_at: "2026-07-17T12:00:00.000Z",
  base_manifest_sha256: "a".repeat(64),
  canonical_manifest_sha256: "b".repeat(64),
});

beforeEach(() => {
  routes = {};
  fetchCalls = [];
  fetchInits = [];
  resetBootstrapPointerCacheForTests();
  resetViewParseStateForTests();
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

  test("one page of sequential base views probes the missing bootstrap pointer only once", async () => {
    routes = {
      "/views/latest.json": { json: { version: "v-live", published_at: "2026-07-19T06:00:00.000Z" } },
      "/views/v-live/rank/all-time/repo/stock.json": { json: { ok: true, tag: "stock" } },
      "/views/v-live/lookup/repos.json": { json: { ok: true, tag: "lookup" } },
      "/views/v-live/entity/repo/1.json": { json: { ok: true, tag: "entity" } },
      "/bootstrap/latest.json": { status: 404 },
    };

    expect(await readView("rank/all-time/repo/stock.json", Doc, { base: true })).toEqual({ ok: true, tag: "stock" });
    expect(await readView("lookup/repos.json", Doc, { base: true })).toEqual({ ok: true, tag: "lookup" });
    expect(await readView("entity/repo/1.json", Doc, { base: true })).toEqual({ ok: true, tag: "entity" });

    expect(fetchCalls.filter((url) => url.includes("/bootstrap/latest.json"))).toHaveLength(1);
  });

  test("coalesces 100 concurrent base reads to one bootstrap pointer fetch in a 404 window", async () => {
    routes = {
      "/views/latest.json": { status: 404 },
      "/rank/all-time/repo/stock.json": { json: { ok: true, tag: "flat" } },
    };

    const results = await Promise.all(
      Array.from({ length: 100 }, () => readView("rank/all-time/repo/stock.json", Doc, { base: true })),
    );

    expect(results.every((value) => value?.tag === "flat")).toBe(true);
    expect(fetchCalls.filter((url) => url.includes("/bootstrap/latest.json"))).toHaveLength(1);
    expect(fetchCalls.filter((url) => url.includes("/views/latest.json")).length).toBeGreaterThan(0);
  });

  test("uses the atomically published bootstrap generation when managed views are absent", async () => {
    routes = {
      "/views/latest.json": { status: 404 },
      "/bootstrap/latest.json": { json: bootstrapPointer() },
      "/bootstrap/generations/bootstrap-20260717T120000Z/views/data/bootstrap.json": {
        json: { ok: true, tag: "bootstrap" },
      },
    };

    const result = await readView("data/bootstrap.json", Doc, { base: true });

    expect(result).toEqual({ ok: true, tag: "bootstrap" });
    expect(fetchCalls.some((url) => url.includes("/bootstrap/latest.json"))).toBe(true);
    expect(
      fetchCalls.some((url) =>
        url.includes("/bootstrap/generations/bootstrap-20260717T120000Z/views/data/bootstrap.json"),
      ),
    ).toBe(true);
  });

  test("managed views/latest.json takes precedence over the bootstrap base generation", async () => {
    routes = {
      "/views/latest.json": { json: { version: "refresh-current" } },
      "/views/refresh-current/data/current.json": { json: { ok: true, tag: "managed" } },
      "/bootstrap/latest.json": { json: bootstrapPointer() },
    };

    expect(await readView("data/current.json", Doc, { base: true })).toEqual({ ok: true, tag: "managed" });
    expect(fetchCalls.some((url) => url.includes("/bootstrap/latest.json"))).toBe(true);
  });

  test("a newer bootstrap commit atomically supersedes an older managed base pointer", async () => {
    routes = {
      "/views/latest.json": {
        json: { version: "refresh-old", published_at: "2026-07-16T12:00:00.000Z" },
      },
      "/bootstrap/latest.json": { json: bootstrapPointer("bootstrap-new") },
      "/views/refresh-old/data/priority.json": { json: { ok: true, tag: "managed-old" } },
      "/bootstrap/generations/bootstrap-new/views/data/priority.json": {
        json: { ok: true, tag: "bootstrap-new" },
      },
    };

    expect(await readView("data/priority.json", Doc, { base: true })).toEqual({ ok: true, tag: "bootstrap-new" });
    expect(fetchCalls.some((url) => url.includes("/views/refresh-old/data/priority.json"))).toBe(false);
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
    expect(fetchCalls.some((u) => u.includes("/bootstrap/latest.json"))).toBe(false);
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
    expect(fetchCalls.some((u) => u.includes("/bootstrap/latest.json"))).toBe(false);
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

    const cacheFor = (path: string) => fetchInits[fetchCalls.findIndex((url) => url.includes(path))]?.cache;
    expect(cacheFor("/bootstrap/latest.json")).toBe("no-store");
    expect(cacheFor("/canonical/v2/meta.json")).toBe("no-store");
    expect(cacheFor("/ops/workflows/run/manifest.json")).toBe("no-store");
    expect(cacheFor("/views/latest.json")).toBe("no-store");
    expect(cacheFor("/views/run/meta.json")).toBe("force-cache");
  });

  test("skipNextDataCache uses no-store so oversized Blob JSON is not copied into Next Data Cache", async () => {
    routes = { "/search/index.json": { json: { ok: true, tag: "search" } } };
    await readView("search/index.json", Doc, { skipNextDataCache: true });
    expect(fetchInits.at(-1)?.cache).toBe("no-store");
  });

  test("resolves every canonical read through the published bootstrap generation", async () => {
    routes = {
      "/bootstrap/latest.json": { json: bootstrapPointer("bootstrap-canonical") },
      "/bootstrap/generations/bootstrap-canonical/canonical/v2/meta.json": {
        json: { ok: true, tag: "generation" },
      },
    };

    expect(await readView("canonical/v2/meta.json", Doc)).toEqual({ ok: true, tag: "generation" });
    expect(
      fetchCalls.some((url) =>
        url.includes("/bootstrap/generations/bootstrap-canonical/canonical/v2/meta.json"),
      ),
    ).toBe(true);
    expect(fetchCalls.some((url) => new URL(url).pathname === "/canonical/v2/meta.json")).toBe(false);
  });

  test("canonical overlays are copy-on-write and take precedence over immutable bootstrap bytes", async () => {
    routes = {
      "/bootstrap/latest.json": { json: bootstrapPointer("bootstrap-overlay") },
      "/bootstrap/overlays/bootstrap-overlay/canonical/v2/meta.json": {
        json: { ok: true, tag: "overlay" },
      },
      "/bootstrap/generations/bootstrap-overlay/canonical/v2/meta.json": {
        json: { ok: true, tag: "sealed" },
      },
    };

    expect(await readView("canonical/v2/meta.json", Doc)).toEqual({ ok: true, tag: "overlay" });
    expect(fetchCalls.some((url) => url.includes("/bootstrap/generations/bootstrap-overlay/canonical/"))).toBe(false);
    expect(await resolveCanonicalBlobPath("canonical/v2/meta.json")).toBe(
      "bootstrap/overlays/bootstrap-overlay/canonical/v2/meta.json",
    );
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
    const canonicalRequests = requestedUrls.filter((url) => new URL(url).pathname === "/canonical/v2/state.json");
    expect(canonicalRequests).toHaveLength(2);
    expect(canonicalRequests[0]).not.toBe(canonicalRequests[1]);
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

    // READ_RETRIES + 1 attempts (currently 4 + 1).
    expect(fetchCalls).toHaveLength(5);
    expect(signals).toHaveLength(5);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  test(
    "retries Blob WAF 403 then treats persistent 403 as absent (null)",
    async () => {
      advancePastTtl();
      let hits = 0;
      globalThis.fetch = mock((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push(url);
        hits += 1;
        return Promise.resolve(makeRes({ status: 403, json: { error: "Forbidden" } }));
      }) as unknown as typeof fetch;

      expect(await readView("entity/repo/1.json", Doc)).toBeNull();
      // All retry attempts were used before giving up as absent.
      expect(hits).toBe(5);
    },
    { timeout: 20_000 },
  );

  test(
    "an authoritative canonical read fails on overlay 403 without falling back to sealed bytes",
    async () => {
      routes = {
        "/bootstrap/latest.json": { json: bootstrapPointer("bootstrap-strict") },
        "/bootstrap/overlays/bootstrap-strict/canonical/v2/meta.json": {
          status: 403,
          json: { error: "Forbidden" },
        },
        "/bootstrap/generations/bootstrap-strict/canonical/v2/meta.json": {
          json: { ok: true, tag: "sealed-stale" },
        },
      };

      await expect(readAuthoritativeView("canonical/v2/meta.json", Doc)).rejects.toThrow(
        "view fetch bootstrap/overlays/bootstrap-strict/canonical/v2/meta.json -> 403",
      );
      expect(
        fetchCalls.some((url) =>
          url.includes("/bootstrap/generations/bootstrap-strict/canonical/v2/meta.json"),
        ),
      ).toBe(false);
    },
    { timeout: 20_000 },
  );

  test("an authoritative base read never falls back to flat bytes after a pointer error", async () => {
    routes = {
      "/views/latest.json": { status: 401, json: { error: "Unauthorized" } },
      "/lookup/repos.json": { json: { ok: true, tag: "flat-stale" } },
    };

    await expect(readAuthoritativeView("lookup/repos.json", Doc, { base: true })).rejects.toThrow(
      "views pointer fetch -> HTTP 401",
    );
    expect(fetchCalls.some((url) => new URL(url).pathname === "/lookup/repos.json")).toBe(false);
  });

  test("a required authoritative view rejects a confirmed 404", async () => {
    routes = {};
    await expect(readRequiredView("ops/workflows/run/manifest.json", Doc)).rejects.toThrow(
      "ops/workflows/run/manifest.json missing",
    );
  });
});

describe("readView — atomic live generation resolution", () => {
  test("all concurrent live reads share one pointer and one complete generation", async () => {
    routes = {
      "/live/latest.json": { status: 200, json: livePointer("generation-a") },
      "/live/generations/generation-a/current_month.json": { status: 200, json: { ok: true, tag: "a-current" } },
      "/live/generations/generation-a/hot-snapshot.json": { status: 200, json: { ok: true, tag: "a-hot" } },
      "/live/generations/generation-b/current_month.json": { status: 200, json: { ok: true, tag: "b-current" } },
      "/live/generations/generation-b/hot-snapshot.json": { status: 200, json: { ok: true, tag: "b-hot" } },
    };

    const [current, hot] = await Promise.all([
      readView("current_month.json", Doc, { live: true, legacyPath: "current_month.json" }),
      readView("hot-snapshot.json", Doc, { live: true, legacyPath: "hot-snapshot.json" }),
    ]);

    expect([current?.tag, hot?.tag]).toEqual(["a-current", "a-hot"]);
    expect(fetchCalls.filter((url) => url.includes("/live/latest.json"))).toHaveLength(1);
    expect(fetchCalls.some((url) => url.includes("generation-b"))).toBe(false);
  });

  test("a pointer flip exposes either the old or new complete generation, never flat siblings", async () => {
    routes = {
      "/live/latest.json": { status: 200, json: livePointer("generation-old") },
      "/live/generations/generation-old/one.json": { status: 200, json: { ok: true, tag: "old-one" } },
      "/live/generations/generation-old/two.json": { status: 200, json: { ok: true, tag: "old-two" } },
      "/live/generations/generation-new/one.json": { status: 200, json: { ok: true, tag: "new-one" } },
      "/live/generations/generation-new/two.json": { status: 200, json: { ok: true, tag: "new-two" } },
      "/legacy/one.json": { status: 200, json: { ok: true, tag: "flat-one" } },
      "/legacy/two.json": { status: 200, json: { ok: true, tag: "flat-two" } },
    };

    expect((await readView("one.json", Doc, { live: true, legacyPath: "legacy/one.json" }))?.tag).toBe("old-one");
    routes["/live/latest.json"] = { status: 200, json: livePointer("generation-new") };
    expect((await readView("two.json", Doc, { live: true, legacyPath: "legacy/two.json" }))?.tag).toBe("old-two");

    clock += 61_000;
    const [one, two] = await Promise.all([
      readView("one.json", Doc, { live: true, legacyPath: "legacy/one.json" }),
      readView("two.json", Doc, { live: true, legacyPath: "legacy/two.json" }),
    ]);
    expect([one?.tag, two?.tag]).toEqual(["new-one", "new-two"]);
    expect(fetchCalls.some((url) => url.includes("/legacy/"))).toBe(false);
  });

  test("only a 404 pointer enables migration fallback to legacy flat paths", async () => {
    process.env.BLOB_BASE_URL = "https://legacy-live.example.com";
    routes = {
      "/live/latest.json": { status: 404 },
      "/legacy/current_month.json": { status: 200, json: { ok: true, tag: "legacy" } },
    };

    expect(
      await readView("current_month.json", Doc, { live: true, legacyPath: "legacy/current_month.json" }),
    ).toEqual({ ok: true, tag: "legacy" });
  });

  test("period-scoped reads walk previous generations before the legacy migration edge", async () => {
    const path = "rank/week/2026-W30/repo/flow.json";
    routes = {
      "/live/latest.json": { status: 200, json: livePointer("history-head") },
      "/live/generations/history-head/manifest.json": {
        status: 200,
        json: liveManifest("history-head", "history-previous", ["current_month.json"]),
      },
      "/live/generations/history-previous/manifest.json": {
        status: 200,
        json: liveManifest("history-previous", null, [path]),
      },
      [`/live/generations/history-previous/${path}`]: {
        status: 200,
        json: { ok: true, tag: "previous-week" },
      },
      [`/live/${path}`]: { status: 200, json: { ok: true, tag: "legacy" } },
    };

    expect(
      await readView(path, Doc, {
        live: true,
        liveHistory: true,
        legacyPath: `live/${path}`,
      }),
    ).toEqual({ ok: true, tag: "previous-week" });
    expect(fetchCalls.some((url) => url.includes(`/live/${path}`))).toBe(false);
  });

  test("period-scoped reads use legacy only after a validated history reaches null", async () => {
    const path = "rank/week/2026-W29/repo/flow.json";
    routes = {
      "/live/latest.json": { status: 200, json: livePointer("history-first") },
      "/live/generations/history-first/manifest.json": {
        status: 200,
        json: liveManifest("history-first", null, ["current_month.json"]),
      },
      [`/live/${path}`]: { status: 200, json: { ok: true, tag: "legacy-week" } },
    };

    expect(
      await readView(path, Doc, {
        live: true,
        liveHistory: true,
        legacyPath: `live/${path}`,
      }),
    ).toEqual({ ok: true, tag: "legacy-week" });
  });

  test("snapshot reads never fall back to stale history or flat bytes after a generation resolves", async () => {
    routes = {
      "/live/latest.json": { status: 200, json: livePointer("snapshot-head") },
      "/live/generations/snapshot-head/current_month.json": { status: 404 },
      "/legacy/current_month.json": { status: 200, json: { ok: true, tag: "stale" } },
    };

    expect(
      await readView("current_month.json", Doc, {
        live: true,
        legacyPath: "legacy/current_month.json",
      }),
    ).toBeNull();
    expect(fetchCalls.some((url) => url.includes("/legacy/current_month.json"))).toBe(false);
  });

  test(
    "a persistent WAF 403 briefly circuits history without selecting older or legacy bytes",
    async () => {
      const path = "heatmap/month/2026-07.json";
      routes = {
        "/live/latest.json": { status: 200, json: livePointer("history-waf-head") },
        [`/live/generations/history-waf-head/${path}`]: {
          status: 403,
          json: { error: "Forbidden" },
        },
        "/live/generations/history-waf-head/manifest.json": {
          status: 200,
          json: liveManifest("history-waf-head", "history-waf-previous", ["current_month.json"]),
        },
        [`/live/generations/history-waf-previous/${path}`]: {
          status: 200,
          json: { ok: true, tag: "stale-generation" },
        },
        [`/live/${path}`]: { status: 200, json: { ok: true, tag: "stale-legacy" } },
      };

      expect(
        await readView(path, Doc, {
          live: true,
          liveHistory: true,
          legacyPath: `live/${path}`,
        }),
      ).toBeNull();
      expect(fetchCalls.filter((url) => url.includes(`/history-waf-head/${path}`))).toHaveLength(2);

      // Repeated page work in the same SSG worker fails closed without paying
      // the retry backoff again while the short per-key circuit is open.
      expect(
        await readView(path, Doc, {
          live: true,
          liveHistory: true,
          legacyPath: `live/${path}`,
        }),
      ).toBeNull();
      expect(fetchCalls.filter((url) => url.includes(`/history-waf-head/${path}`))).toHaveLength(2);
      expect(fetchCalls.some((url) => url.includes("/history-waf-head/manifest.json"))).toBe(false);
      expect(fetchCalls.some((url) => url.includes("history-waf-previous"))).toBe(false);
      expect(fetchCalls.some((url) => url.includes(`/live/${path}`))).toBe(false);

      // The circuit is temporary: after one pointer TTL, a healthy immutable
      // object is read normally instead of remaining process-poisoned.
      clock += 61_000;
      routes[`/live/generations/history-waf-head/${path}`] = {
        status: 200,
        json: { ok: true, tag: "recovered-head" },
      };
      expect(
        await readView(path, Doc, {
          live: true,
          liveHistory: true,
          legacyPath: `live/${path}`,
        }),
      ).toEqual({ ok: true, tag: "recovered-head" });
      expect(fetchCalls.filter((url) => url.includes(`/history-waf-head/${path}`))).toHaveLength(3);
    },
    { timeout: 20_000 },
  );

  test(
    "an unreachable pointer omits the published live overlay without guessing legacy bytes",
    async () => {
      process.env.BLOB_BASE_URL = "https://uncached-live.example.com";
      globalThis.fetch = mock((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push(url);
        if (url.includes("/live/latest.json")) return Promise.reject(new Error("network down"));
        return Promise.resolve(makeRes({ status: 200, json: { ok: true, tag: "unsafe-flat" } }));
      }) as unknown as typeof fetch;

      expect(
        await readView("current_month.json", Doc, { live: true, legacyPath: "legacy/current_month.json" }),
      ).toBeNull();
      // Pointer is retried on transient failures; legacy flat must never be guessed.
      expect(fetchCalls.filter((url) => url.includes("/live/latest.json")).length).toBeGreaterThan(1);
      expect(fetchCalls.some((url) => url.includes("legacy/current_month.json"))).toBe(false);
    },
    { timeout: 20_000 },
  );

  test(
    "a persistent pointer WAF 403 is briefly circuited for published reads",
    async () => {
      process.env.BLOB_BASE_URL = "https://waf-live.example.com";
      let pointerDenied = true;
      globalThis.fetch = mock((input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        fetchCalls.push(url);
        if (url.includes("/live/latest.json")) {
          if (!pointerDenied) {
            return Promise.resolve(makeRes({ status: 200, json: livePointer("waf-recovered") }));
          }
          return Promise.resolve({
            ...makeRes({ status: 403, json: { error: "Forbidden" } }),
            headers: new Headers({ "retry-after": "0.001" }),
          } as Response);
        }
        if (url.includes("/live/generations/waf-recovered/hot-snapshot.json")) {
          return Promise.resolve(makeRes({ status: 200, json: { ok: true, tag: "recovered" } }));
        }
        return Promise.resolve(makeRes({ status: 200, json: { ok: true, tag: "unsafe-flat" } }));
      }) as unknown as typeof fetch;

      expect(
        await readView("current_month.json", Doc, { live: true, legacyPath: "legacy/current_month.json" }),
      ).toBeNull();
      const pointerAttempts = fetchCalls.filter((url) => url.includes("/live/latest.json")).length;
      expect(pointerAttempts).toBeGreaterThan(1);

      expect(
        await readView("hot-snapshot.json", Doc, { live: true, legacyPath: "legacy/hot-snapshot.json" }),
      ).toBeNull();
      expect(fetchCalls.filter((url) => url.includes("/live/latest.json"))).toHaveLength(pointerAttempts);
      expect(fetchCalls.some((url) => url.includes("/legacy/"))).toBe(false);

      pointerDenied = false;
      clock += 61_000;
      expect(
        await readView("hot-snapshot.json", Doc, { live: true, legacyPath: "legacy/hot-snapshot.json" }),
      ).toEqual({ ok: true, tag: "recovered" });
      expect(fetchCalls.some((url) => url.includes("/live/generations/waf-recovered/hot-snapshot.json"))).toBe(true);
    },
    { timeout: 20_000 },
  );

  test("an authoritative live read still fails on an unavailable pointer", async () => {
    process.env.BLOB_BASE_URL = "https://authoritative-live.example.com";
    routes = {
      "/live/latest.json": { status: 401, json: { error: "Unauthorized" } },
      "/legacy/current_month.json": { status: 200, json: { ok: true, tag: "unsafe-flat" } },
    };

    await expect(
      readAuthoritativeView("current_month.json", Doc, {
        live: true,
        legacyPath: "legacy/current_month.json",
      }),
    ).rejects.toThrow("live pointer fetch -> HTTP 401");
    expect(fetchCalls.some((url) => url.includes("legacy/current_month.json"))).toBe(false);
  });
});
