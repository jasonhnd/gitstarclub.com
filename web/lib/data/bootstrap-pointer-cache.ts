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

export function invalidateBootstrapPointerCache(): void {
  memory = null;
  inflight = null;
}

/** Test/process helper. Does not clear the shared Next Data Cache. */
export function resetBootstrapPointerCacheForTests(): void {
  invalidateBootstrapPointerCache();
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

  const pending = (async () => {
    const value = await loadThroughSharedCache(load);
    memory = { value, expiresAt: Date.now() + BOOTSTRAP_POINTER_NEGATIVE_TTL_MS };
    return value;
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
  try {
    const nextCache = await import("next/cache");
    if (typeof nextCache.unstable_cache !== "function") return load();
    const cachedLoad = nextCache.unstable_cache(load, [BOOTSTRAP_POINTER_CACHE_KEY], {
      revalidate: BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
      tags: [BOOTSTRAP_POINTER_CACHE_TAG],
    });
    return await cachedLoad();
  } catch {
    return load();
  }
}
