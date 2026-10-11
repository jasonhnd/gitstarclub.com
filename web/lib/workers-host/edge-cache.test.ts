import { describe, expect, test } from "bun:test";
import { cfBuildCommitSha } from "../cf-build-identity";
import { EDGE_CACHE_MAX_TTL_SECONDS, edgeCacheKey, edgeCacheTtl, handleEdgeCachedNext, type EdgeCache, type EdgeCacheEnv } from "./edge-cache";

function harness(headers: HeadersInit = { "cache-control": "public, s-maxage=300" }, status = 200) {
  const entries = new Map<string, Response>();
  const pending: Promise<unknown>[] = [];
  let renders = 0;
  let writes = 0;
  const cache: EdgeCache = {
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { writes++; entries.set(key.url, response.clone()); },
  };
  const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
  return {
    entries, cache, ctx,
    get renders() { return renders; },
    get writes() { return writes; },
    async run(request = new Request("https://example.com/rankings"), env: EdgeCacheEnv = {}) {
      const response = await handleEdgeCachedNext(request, env, ctx, () => {
        renders++;
        return new Response("page-content", { headers, status });
      }, cache);
      await Promise.all(pending);
      return response;
    },
  };
}

describe("Worker edge cache", () => {
  test("second GET hits with identical content without rendering again", async () => {
    const h = harness();
    const first = await h.run();
    expect(first.headers.get("x-gsc-cache")).toBe("MISS");
    expect(await first.text()).toBe("page-content");
    const second = await h.run();
    expect(second.headers.get("x-gsc-cache")).toBe("HIT");
    expect(await second.text()).toBe("page-content");
    expect(h.renders).toBe(1);
    expect(h.writes).toBe(1);
  });

  test("excluded methods, paths and sensitive headers bypass even a warm cache", async () => {
    const h = harness();
    await h.run();
    for (const request of [
      ...["POST", "HEAD"].map((method) => new Request("https://example.com/rankings", { method })),
      ...["/api", "/api/test", "/api/workflows/refresh/x", "/rankings/refresh-now", "/start/", "/enqueue", "/preview/other", "/.well-known/test"]
        .map((path) => new Request(`https://example.com${path}`)),
      ...["Authorization", "Cookie", "Range"].map((header) => new Request("https://example.com/rankings", { headers: { [header]: "" } })),
    ]) {
      expect((await h.run(request)).headers.get("x-gsc-cache")).toBe("BYPASS");
    }
    expect(h.writes).toBe(1);
  });

  test("ineligible responses never write", async () => {
    const excludedHeaders: HeadersInit[] = [
      {}, { "cache-control": "public, max-age=600" },
      ...["private", "private=\"x-test\"", "no-store", "no-cache", "no-cache=\"x-test\"", "s-maxage=0", "s-maxage=-1", "s-maxage=bad"]
        .map((directive) => ({ "cache-control": `s-maxage=300, ${directive}` })),
      { "cache-control": "s-maxage=300", "set-cookie": "session=test" },
      { "cache-control": "s-maxage=300", vary: "Accept, *" },
    ];
    for (const headers of excludedHeaders) {
      const h = harness(headers);
      expect((await h.run()).headers.get("x-gsc-cache")).toBe("BYPASS");
      expect(h.writes).toBe(0);
    }
    const h = harness({ "cache-control": "s-maxage=300" }, 404);
    expect((await h.run()).headers.get("x-gsc-cache")).toBe("BYPASS");
    expect(h.writes).toBe(0);
  });

  test("HTML, RSC, router state and prefetch variants have separate entries", async () => {
    const h = harness();
    const variants: HeadersInit[] = [{}, { RSC: "1" }, { "Next-Router-State-Tree": "tree-a" }, { "Next-Router-State-Tree": "tree-b" }, { "Next-Router-Prefetch": "1" }];
    for (const headers of variants) {
      const request = new Request("https://example.com/rankings", { headers });
      expect((await h.run(request)).headers.get("x-gsc-cache")).toBe("MISS");
      expect((await h.run(request)).headers.get("x-gsc-cache")).toBe("HIT");
    }
    expect(h.entries.size).toBe(5);
  });

  test("query parameters and version components isolate keys", async () => {
    const request = new Request("https://example.com/rankings?lang=en&_rsc=one&__gsc_cv=user");
    const baseline = await edgeCacheKey(request, {});
    const url = new URL(baseline.url);
    expect(url.searchParams.get("_rsc")).toBe("one");
    expect(url.searchParams.getAll("__gsc_cv")).toEqual(["user", JSON.stringify(["v1", "", cfBuildCommitSha || ""])]);
    for (const env of [{ EDGE_CACHE_VERSION: "v2" }, { VIEWS_VERSION_FALLBACK: "weekly-new" }]) {
      expect((await edgeCacheKey(request, env)).url).not.toBe(baseline.url);
    }
    for (const env of [{ CF_PREVIEW_COMMIT_SHA: "new-build" }, { VERCEL_GIT_COMMIT_SHA: "new-build" }]) {
      const key = new URL((await edgeCacheKey(request, env)).url);
      expect(key.searchParams.getAll("__gsc_cv")).toEqual(["user", JSON.stringify(["v1", "", cfBuildCommitSha || "new-build"])]);
    }
    expect((await edgeCacheKey(new Request("https://example.com/rankings?lang=en&_rsc=two"), {})).url).not.toBe(baseline.url);
    const h = harness();
    expect((await h.run(request)).headers.get("x-gsc-cache")).toBe("MISS");
    expect((await h.run(request, { EDGE_CACHE_VERSION: "v2" })).headers.get("x-gsc-cache")).toBe("MISS");
  });

  test("stores short and long origin lifetimes for one hour and restores the origin policy on HIT", async () => {
    for (const seconds of [60, 31536000]) {
      const policy = `public, s-maxage=${seconds}`;
      const h = harness({ "cache-control": policy, "content-type": "text/x-component" });
      const response = await h.run();
      expect(response.headers.get("x-gsc-cache")).toBe("MISS");
      expect(response.headers.get("cache-control")).toBe(policy);
      expect([...h.entries.values()][0].headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
      const hit = await h.run();
      expect(hit.headers.get("x-gsc-cache")).toBe("HIT");
      expect(hit.headers.get("cache-control")).toBe(policy);
      expect(hit.headers.has("x-gsc-cache-origin-control")).toBe(false);
    }
    expect(edgeCacheTtl(new Response("{}", { headers: { "cache-control": 'PUBLIC, S-MAXAGE="60"', "content-type": "application/json", vary: "RSC" } }))).toBe(3600);
  });

  test("uses EDGE_CACHE_TTL for storage and caps it at one day", async () => {
    for (const [value, ttl] of [["600", 600], ["999999", EDGE_CACHE_MAX_TTL_SECONDS]] as const) {
      const h = harness({ "cache-control": "public, s-maxage=60" });
      const env = { EDGE_CACHE_TTL: value };
      expect((await h.run(undefined, env)).headers.get("cache-control")).toBe("public, s-maxage=60");
      expect([...h.entries.values()][0].headers.get("cache-control")).toBe(`public, max-age=${ttl}, s-maxage=${ttl}`);
      const hit = await h.run(undefined, env);
      expect(hit.headers.get("x-gsc-cache")).toBe("HIT");
      expect(hit.headers.get("cache-control")).toBe("public, s-maxage=60");
    }
  });

  test("empty, invalid and non-positive EDGE_CACHE_TTL values fall back to one hour", async () => {
    for (const value of ["", "bad", "0", "000", "-1", "1.5", "+600", "600seconds", "6e2", " 600", "600 ", "600\n"]) {
      const h = harness({ "cache-control": "public, s-maxage=60" });
      expect((await h.run(undefined, { EDGE_CACHE_TTL: value })).headers.get("x-gsc-cache")).toBe("MISS");
      expect([...h.entries.values()][0].headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
    }
  });

  test("missing Cache API bypasses and cache failures preserve the response", async () => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil(promise: Promise<unknown>) { pending.push(promise); } };
    const request = new Request("https://example.com/rankings");
    const next = () => new Response("content", { headers: { "cache-control": "s-maxage=300" } });
    const missing = await handleEdgeCachedNext(request, {}, ctx, next);
    expect(missing.headers.get("x-gsc-cache")).toBe("BYPASS");
    const failingRead: EdgeCache = { async match() { throw new Error("read failed"); }, async put() {} };
    const bypass = await handleEdgeCachedNext(request, {}, ctx, next, failingRead);
    expect(bypass.headers.get("x-gsc-cache")).toBe("BYPASS");
    expect(await bypass.text()).toBe("content");
    const failingWrite: EdgeCache = { async match() { return undefined; }, async put() { throw new Error("write failed"); } };
    const miss = await handleEdgeCachedNext(request, {}, ctx, next, failingWrite);
    expect(miss.headers.get("x-gsc-cache")).toBe("MISS");
    expect(await miss.text()).toBe("content");
    await Promise.all(pending);
  });
});
