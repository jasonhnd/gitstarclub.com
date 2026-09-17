import { describe, expect, test } from "bun:test";
import { BOOTSTRAP_POINTER_CACHE_TAG, PUBLISHED_VIEWS_CACHE_TAG } from "@/lib/data/publication-cache-contract";
import { invalidatePublishedViews } from "@/lib/workflows/publication-cache";
import { CfStubCacheInvalidation } from "./cf-stub";
import { MemoryCacheInvalidation } from "./memory";
import { describeCacheInvalidation, resolveCacheInvalidation } from "./resolve";
import { VercelCacheInvalidation } from "./vercel";

describe("cache-invalidation port", () => {
  test("defaults to the Vercel driver", () => {
    expect(describeCacheInvalidation({ env: {} }).kind).toBe("vercel");
    expect(resolveCacheInvalidation({ env: {} })).toBeInstanceOf(VercelCacheInvalidation);
  });

  test("resolves memory and cf-stub drivers", () => {
    expect(resolveCacheInvalidation({ env: { CACHE_INVALIDATION_DRIVER: "memory" } })).toBeInstanceOf(
      MemoryCacheInvalidation,
    );
    expect(resolveCacheInvalidation({ env: { CACHE_INVALIDATION_DRIVER: "cf-stub" } })).toBeInstanceOf(
      CfStubCacheInvalidation,
    );
  });

  test("refuses non-Vercel drivers in Vercel production", () => {
    expect(() =>
      resolveCacheInvalidation({ env: { CACHE_INVALIDATION_DRIVER: "cf-stub", VERCEL_ENV: "production" } }),
    ).toThrow("VERCEL_ENV=production");
    expect(() =>
      resolveCacheInvalidation({ env: { CACHE_INVALIDATION_DRIVER: "memory", VERCEL_ENV: "production" } }),
    ).toThrow("VERCEL_ENV=production");
    expect(resolveCacheInvalidation({ env: { VERCEL_ENV: "production" } })).toBeInstanceOf(VercelCacheInvalidation);
  });

  test("Vercel driver wraps revalidatePath and revalidateTag", async () => {
    const calls: Array<{ kind: string; value: string; extra?: unknown }> = [];
    const cache = new VercelCacheInvalidation({
      revalidatePath: (path, type) => {
        calls.push({ kind: "path", value: path, extra: type });
      },
      revalidateTag: (tag, options) => {
        calls.push({ kind: "tag", value: tag, extra: options });
      },
    });
    await cache.revalidateTag("published-views-pointer", { expire: 0 });
    await cache.revalidatePath("/", "layout");
    expect(calls).toEqual([
      { kind: "tag", value: "published-views-pointer", extra: { expire: 0 } },
      { kind: "path", value: "/", extra: "layout" },
    ]);
  });

  test("publication invalidation records tags plus hot paths / and /pulse", async () => {
    const cache = new MemoryCacheInvalidation();
    await invalidatePublishedViews(cache);
    expect(cache.tags()).toEqual([PUBLISHED_VIEWS_CACHE_TAG, BOOTSTRAP_POINTER_CACHE_TAG]);
    expect(cache.paths()).toContain("/");
    expect(cache.paths()).toContain("/pulse");
    expect(cache.ops[0]).toEqual({ kind: "tag", tag: PUBLISHED_VIEWS_CACHE_TAG, options: { expire: 0 } });
  });

  test("CF stub records hot-path ops, logs JSON, and POSTs the Worker envelope", async () => {
    const posts: Array<{ url: string; auth: string | null; accessId: string | null; body: unknown }> = [];
    const lines: string[] = [];
    const stub = new CfStubCacheInvalidation({
      env: {
        CF_CACHE_PURGE_URL: "https://gitstarclub-web.worldgo.workers.dev/preview/invalidate",
        CRON_SECRET: "cron-secret",
        CF_ACCESS_CLIENT_ID: "access-id",
        CF_ACCESS_CLIENT_SECRET: "access-secret",
      },
      log: (line) => lines.push(line),
      fetchImpl: async (input, init) => {
        const headers = new Headers(init?.headers);
        posts.push({
          url: String(input),
          auth: headers.get("authorization"),
          accessId: headers.get("CF-Access-Client-Id"),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ ok: true });
      },
    });

    await stub.revalidatePath("/");
    await stub.revalidatePath("/pulse");
    await stub.revalidateTag("published-views-pointer", { expire: 0 });

    expect(stub.recorder.paths()).toEqual(["/", "/pulse"]);
    expect(stub.recorder.tags()).toEqual(["published-views-pointer"]);
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "cache.invalidate", driver: "cf-stub", path: "/" });
    expect(posts).toHaveLength(3);
    expect(posts[0]?.url).toBe("https://gitstarclub-web.worldgo.workers.dev/preview/invalidate");
    expect(posts[0]?.auth).toBe("Bearer cron-secret");
    expect(posts[0]?.accessId).toBe("access-id");
    expect(posts[0]?.body).toEqual({ v: 1, driver: "cf-stub", ops: [{ kind: "path", path: "/" }] });
  });
});
