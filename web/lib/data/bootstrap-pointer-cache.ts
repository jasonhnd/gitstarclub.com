import type { BootstrapPublicationPointer as BootstrapPointer } from "@/lib/contracts";
import {
  BOOTSTRAP_POINTER_CACHE_KEY,
  BOOTSTRAP_POINTER_CACHE_TAG,
  BOOTSTRAP_POINTER_NEGATIVE_TTL_MS,
  BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
} from "@/lib/data/publication-cache-contract";

export type CachedBootstrapPointer =
  | { state: "present"; pointer: BootstrapPointer }
  | { state: "absent" };

type MemoryRecord = {
  value: CachedBootstrapPointer;
  expiresAt: number;
};

let memory: MemoryRecord | null = null;
let inflight: Promise<CachedBootstrapPointer> | null = null;
let lastKnownGood: CachedBootstrapPointer | null = null;
let failureMemo: { error: Error; at: number } | null = null;
let failureLoggedAt = 0;

export function invalidateBootstrapPointerCache(): void {
  memory = null;
  inflight = null;
}

/** Test/process helper. Does not clear the shared Next Data Cache. */
export function resetBootstrapPointerCacheForTests(): void {
  invalidateBootstrapPointerCache();
  lastKnownGood = null;
  failureMemo = null;
  failureLoggedAt = 0;
}

/**
 * Cache the published bootstrap pointer, including a confirmed 404.
 *
 * Production is a long-lived legacy-flat layout: `bootstrap/latest.json` is
 * expected to be missing. That absence is a normal state, not an error to
 * re-probe on every view read. A 404 sentinel therefore lives in:
 *   1. in-flight coalesce (same render / concurrent callers)
 *   2. process memory (same isolate, TTL)
 *   3. Next Data Cache (cross-request / cross-instance, tagged)
 *
 * 403 / 429 / 5xx / network failures must throw from `load` and are never stored.
 */
export async function readCachedBootstrapPointer(
  load: () => Promise<CachedBootstrapPointer>,
  now = Date.now(),
): Promise<CachedBootstrapPointer> {
  if (memory && memory.expiresAt > now) return memory.value;
  if (inflight) return inflight;
  if (failureMemo && now - failureMemo.at < BOOTSTRAP_POINTER_NEGATIVE_TTL_MS) {
    if (lastKnownGood) return lastKnownGood;
    throw failureMemo.error;
  }

  const pending = (async () => {
    try {
      const value = await loadThroughSharedCache(load);
      memory = { value, expiresAt: Date.now() + BOOTSTRAP_POINTER_NEGATIVE_TTL_MS };
      lastKnownGood = value;
      failureMemo = null;
      return value;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const failedAt = Date.now();
      failureMemo = { error: failure, at: failedAt };
      if (failedAt - failureLoggedAt >= BOOTSTRAP_POINTER_NEGATIVE_TTL_MS) {
        failureLoggedAt = failedAt;
        console.error("[bootstrap-pointer] origin fetch failed", {
          message: failure.message,
          using_last_known_good: lastKnownGood !== null,
          last_known_good_state: lastKnownGood?.state ?? null,
        });
      }
      if (lastKnownGood) return lastKnownGood;
      throw failure;
    }
  })();
  inflight = pending;
  try {
    return await pending;
  } finally {
    if (inflight === pending) inflight = null;
  }
}

async function loadThroughSharedCache(
  load: () => Promise<CachedBootstrapPointer>,
): Promise<CachedBootstrapPointer> {
  // Call the Data Cache only on a live Next request. `next build` still
  // bundles this import; @opentelemetry/api is a direct dependency so that
  // graph resolves. Tests keep the in-process 404 sentinel only.
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") {
    return load();
  }
  let cachedLoad: (() => Promise<CachedBootstrapPointer>) | undefined;
  try {
    const nextCache = await import("next/cache");
    if (typeof nextCache.unstable_cache !== "function") return load();
    cachedLoad = nextCache.unstable_cache(load, [BOOTSTRAP_POINTER_CACHE_KEY], {
      revalidate: BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
      tags: [BOOTSTRAP_POINTER_CACHE_TAG],
    });
  } catch {
    // Only infrastructure failures (next/cache unavailable) fall back to load().
    // A 403/429/5xx from `load` itself must propagate — never fetch twice.
    return load();
  }
  return cachedLoad();
}
