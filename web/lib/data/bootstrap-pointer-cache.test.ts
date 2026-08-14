import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  readBootstrapPublicationPointer,
  invalidateBootstrapPointerCache,
} from "./bootstrap-publication";
import { resetBootstrapPointerCacheForTests } from "./bootstrap-pointer-cache";
import { BOOTSTRAP_POINTER_NEGATIVE_TTL_MS } from "./publication-cache-contract";

const BLOB = "https://blob.example.com";
const originalBase = process.env.BLOB_BASE_URL;
const originalPublicBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
const realFetch = globalThis.fetch;
const realNow = Date.now;

let clock = 1_000_000;
let fetchCalls: string[] = [];
let fetchInits: Array<RequestInit & { next?: { revalidate?: number; tags?: string[] } }> = [];
let routes: Record<string, { status?: number; json?: unknown }> = {};

function pointer(generation = "bootstrap-20260717T120000Z") {
  return {
    schema_ver: 1,
    generation,
    prefix: `bootstrap/generations/${generation}`,
    previous_generation: null,
    published_at: "2026-07-17T12:00:00.000Z",
    base_manifest_sha256: "a".repeat(64),
    canonical_manifest_sha256: "b".repeat(64),
  };
}

function makeRes(route: { status?: number; json?: unknown }): Response {
  const status = route.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => route.json,
  } as Response;
}

beforeEach(() => {
  fetchCalls = [];
  fetchInits = [];
  routes = {};
  clock = 1_000_000;
  resetBootstrapPointerCacheForTests();
  process.env.BLOB_BASE_URL = BLOB;
  delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  Date.now = () => clock;
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchCalls.push(url);
    fetchInits.push((init ?? {}) as RequestInit & { next?: { revalidate?: number; tags?: string[] } });
    const path = url.split("?")[0] ?? url;
    const route = Object.keys(routes)
      .filter((key) => path.endsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    return Promise.resolve(makeRes(route ? routes[route] : { status: 404 }));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  resetBootstrapPointerCacheForTests();
  if (originalBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBase;
  if (originalPublicBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBase;
});

describe("published bootstrap pointer cache", () => {
  test("returns a valid pointer when the object exists", async () => {
    routes = { "/bootstrap/latest.json": { json: pointer() } };
    const result = await readBootstrapPublicationPointer({ published: true });
    expect(result?.generation).toBe("bootstrap-20260717T120000Z");
    expect(fetchCalls.filter((url) => url.includes("/bootstrap/latest.json"))).toHaveLength(1);
    expect(fetchCalls[0]?.includes("?")).toBe(false);
  });

  test("treats a confirmed 404 as legacy-flat absence", async () => {
    routes = { "/bootstrap/latest.json": { status: 404 } };
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();
  });

  test("coalesces 100 concurrent published reads into one origin fetch", async () => {
    let inflight = 0;
    let maxInflight = 0;
    let originFetches = 0;
    globalThis.fetch = mock((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      originFetches += 1;
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          inflight -= 1;
          resolve(makeRes({ status: 404 }));
        }, 5);
      });
    }) as unknown as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 100 }, () => readBootstrapPublicationPointer({ published: true })),
    );

    expect(results.every((value) => value === null)).toBe(true);
    expect(originFetches).toBe(1);
    expect(maxInflight).toBe(1);
  });

  test("reuses the negative cache inside the TTL window", async () => {
    routes = { "/bootstrap/latest.json": { status: 404 } };
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();
    expect(fetchCalls.filter((url) => url.includes("/bootstrap/latest.json"))).toHaveLength(1);
  });

  test("sees a newly published pointer after TTL expiry", async () => {
    routes = { "/bootstrap/latest.json": { status: 404 } };
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();

    clock += BOOTSTRAP_POINTER_NEGATIVE_TTL_MS + 1;
    routes = { "/bootstrap/latest.json": { json: pointer("bootstrap-new") } };

    const result = await readBootstrapPublicationPointer({ published: true });
    expect(result?.generation).toBe("bootstrap-new");
    expect(fetchCalls.filter((url) => url.includes("/bootstrap/latest.json")).length).toBeGreaterThan(1);
  });

  test("rollback to a missing pointer is visible after invalidation", async () => {
    routes = { "/bootstrap/latest.json": { json: pointer() } };
    expect((await readBootstrapPublicationPointer({ published: true }))?.generation).toBe(
      "bootstrap-20260717T120000Z",
    );

    routes = { "/bootstrap/latest.json": { status: 404 } };
    invalidateBootstrapPointerCache();
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();
  });

  test("publication invalidation makes a new pointer visible immediately", async () => {
    routes = { "/bootstrap/latest.json": { status: 404 } };
    expect(await readBootstrapPublicationPointer({ published: true })).toBeNull();

    routes = { "/bootstrap/latest.json": { json: pointer("bootstrap-after-publish") } };
    invalidateBootstrapPointerCache();

    const result = await readBootstrapPublicationPointer({ published: true });
    expect(result?.generation).toBe("bootstrap-after-publish");
  });

  test("does not treat 403 as a missing pointer", async () => {
    routes = { "/bootstrap/latest.json": { status: 403 } };
    await expect(readBootstrapPublicationPointer({ published: true })).rejects.toThrow("403");
    expect(await readBootstrapPublicationPointer({ published: true }).catch((error) => error)).toBeInstanceOf(Error);
  });

  test("does not treat 429 as a missing pointer", async () => {
    routes = { "/bootstrap/latest.json": { status: 429 } };
    await expect(readBootstrapPublicationPointer({ published: true })).rejects.toThrow("429");
  });

  test("does not treat 503 as a missing pointer", async () => {
    routes = { "/bootstrap/latest.json": { status: 503 } };
    await expect(readBootstrapPublicationPointer({ published: true })).rejects.toThrow("503");
  });

  test("does not treat a network failure as a missing pointer", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch;
    await expect(readBootstrapPublicationPointer({ published: true })).rejects.toThrow("socket hang up");
  });
});
