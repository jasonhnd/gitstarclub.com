import type { BootstrapPublicationPointer as BootstrapPointer } from "@/lib/contracts";
import { BOOTSTRAP_POINTER_NEGATIVE_TTL_MS } from "@/lib/data/publication-cache-contract";

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

/** Test/process helper. */
export function resetBootstrapPointerCacheForTests(): void {
  invalidateBootstrapPointerCache();
}

/**
 * Cross-request cache for the published bootstrap pointer.
 * Confirmed 404s are stored as `absent`. Transport/WAF/5xx errors must throw
 * from `load` so they never become a legacy-flat sentinel.
 *
 * This stays in-process on purpose: importing `next/cache` from the page data
 * graph makes `next build` require `@opentelemetry/api`. Cross-isolate sharing
 * uses the tagged fetch in `bootstrap-publication.ts`.
 */
export async function readCachedBootstrapPointer(
  load: () => Promise<CachedBootstrapPointer>,
  now = Date.now(),
): Promise<CachedBootstrapPointer> {
  if (memory && memory.expiresAt > now) return memory.value;
  if (inflight) return inflight;

  const pending = (async () => {
    const value = await load();
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
