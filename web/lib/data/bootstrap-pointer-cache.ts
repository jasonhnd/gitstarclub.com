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

/** Test/process helper. Does not touch the shared Next Data Cache. */
export function resetBootstrapPointerCacheForTests(): void {
  invalidateBootstrapPointerCache();
}

/**
 * Cross-request cache for the published bootstrap pointer.
 * Confirmed 404s are stored as `absent`. Transport/WAF/5xx errors must throw
 * from `load` so they never become a legacy-flat sentinel.
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

function sharedDataCacheEnabled(): boolean {
  return process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge" || process.env.VERCEL === "1";
}

async function loadThroughSharedCache(
  load: () => Promise<CachedBootstrapPointer>,
): Promise<CachedBootstrapPointer> {
  if (!sharedDataCacheEnabled()) return load();
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
