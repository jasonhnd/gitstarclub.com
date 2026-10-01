import { describe, expect, test } from "bun:test";
import { BOOTSTRAP_POINTER_CACHE_TAG, PUBLISHED_VIEWS_CACHE_TAG } from "@/lib/data/publication-cache-contract";
import { invalidatePublishedViews } from "@/lib/workflows/publication-cache";
import { CF_STUB_POST_DEADLINE_MS, CfStubCacheInvalidation } from "./cf-stub";
import { MemoryCacheInvalidation } from "./memory";
import { describeCacheInvalidation, resolveCacheInvalidation } from "./resolve";
import { VercelCacheInvalidation } from "./vercel";

const HUNG_MS = 500;

async function outcomeOf(work: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => "resolved",
        (error: unknown) => error,
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("hung"), HUNG_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function expectTimeout(outcome: unknown): void {
  expect(outcome).toBeInstanceOf(Error);
  expect(outcome).toMatchObject({ name: "TimeoutError", message: "The operation timed out." });
}

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
    const posts: Array<{
      url: string;
      auth: string | null;
      accessId: string | null;
      body: unknown;
      method: string | null;
      aborted: boolean | null;
    }> = [];
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
          method: init?.method ?? null,
          aborted: init?.signal?.aborted ?? null,
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
    expect(posts[0]?.method).toBe("POST");
    expect(posts[0]?.aborted).toBe(false);
    expect(CF_STUB_POST_DEADLINE_MS).toBe(15_000);
  });

  test("aborts a never-settling cache-invalidation POST", async () => {
    let sawSignal: AbortSignal | undefined;
    const stub = new CfStubCacheInvalidation({
      purgeUrl: "https://example.test/preview/invalidate",
      deadlineMs: 40,
      log: () => {},
      fetchImpl: (_input, init) => {
        sawSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    });
    expectTimeout(await outcomeOf(stub.revalidatePath("/")));
    expect(sawSignal?.aborted).toBe(true);
  });

  test("aborts a cache-invalidation POST that ignores the abort signal", async () => {
    const stub = new CfStubCacheInvalidation({
      purgeUrl: "https://example.test/preview/invalidate",
      deadlineMs: 40,
      log: () => {},
      fetchImpl: () => new Promise(() => {}),
    });
    expectTimeout(await outcomeOf(stub.revalidatePath("/")));
  });

  test("aborts a cache-invalidation response body that never settles", async () => {
    let cancelled = false;
    const stub = new CfStubCacheInvalidation({
      purgeUrl: "https://example.test/preview/invalidate",
      deadlineMs: 40,
      log: () => {},
      fetchImpl: () =>
        Promise.resolve({
          ok: true,
          status: 200,
          body: {
            cancel: () => {
              cancelled = true;
              return Promise.resolve();
            },
          },
          text: () => new Promise(() => {}),
        } as unknown as Response),
    });
    expectTimeout(await outcomeOf(stub.revalidatePath("/")));
    expect(cancelled).toBe(true);
  });

  test("a non-OK cache-invalidation POST still throws the status without reading the body", async () => {
    let readBody = false;
    const stub = new CfStubCacheInvalidation({
      purgeUrl: "https://example.test/preview/invalidate",
      deadlineMs: 40,
      log: () => {},
      fetchImpl: async () =>
        ({
          ok: false,
          status: 503,
          text: () => {
            readBody = true;
            return new Promise(() => {});
          },
        }) as unknown as Response,
    });
    const outcome = await outcomeOf(stub.revalidatePath("/"));
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("CF cache-invalidation stub -> 503");
    expect(readBody).toBe(false);
  });
});
