import { BootstrapPublicationPointer, type BootstrapPublicationPointer as BootstrapPointer } from "@/lib/contracts";
import {
  readCachedBootstrapPointer,
  invalidateBootstrapPointerCache,
  type CachedBootstrapPointer,
} from "@/lib/data/bootstrap-pointer-cache";
import {
  BOOTSTRAP_POINTER_CACHE_TAG,
  BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
} from "@/lib/data/publication-cache-contract";
import { BLOB_JSON_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl } from "@/lib/runtime-config";

export const BOOTSTRAP_POINTER_PATH = "bootstrap/latest.json";
export { invalidateBootstrapPointerCache };

let pointerReadSequence = 0;
const POINTER_READ_RETRIES = 4;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let sleepImpl = defaultSleep;
let randomImpl = Math.random;

/** Test seam so 403 retry tests do not wait on real backoff. */
export function setBootstrapPointerRetryHooksForTests(
  hooks: { sleep?: (ms: number) => Promise<void>; random?: () => number } | null,
): void {
  sleepImpl = hooks?.sleep ?? defaultSleep;
  randomImpl = hooks?.random ?? Math.random;
}

function shouldRetryPointerStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

function pointerRetryDelayMs(status: number, attempt: number, random = randomImpl): number {
  const retryAfterCap = 10_000;
  const base = status === 403 ? 400 : 250;
  const cap = status === 403 ? 3_000 : 2_000;
  const exp = Math.min(base * 2 ** (attempt - 1), cap);
  const jitter = Math.floor(random() * 0.25 * exp);
  return Math.min(exp + jitter, retryAfterCap);
}

// Authoritative reads coalesce only in-flight work so a newly committed or
// rolled-back pointer is visible to the next operation.
const authoritativeReads = new Map<string, Promise<BootstrapPointer | null>>();

type PointerReadOptions = {
  /** ISR-safe for base-page fallback; authoritative reads bypass every cache. */
  published?: boolean;
  timeoutMs?: number;
};

function publishedPointerUrl(blobBase: string): string {
  return `${blobBase}/${BOOTSTRAP_POINTER_PATH}`;
}

function authoritativePointerUrl(blobBase: string): string {
  return `${blobBase}/${BOOTSTRAP_POINTER_PATH}?v=${Date.now().toString(36)}-${++pointerReadSequence}`;
}

/**
 * Origin read for the one-file bootstrap commit point.
 * A 404 means "legacy flat is the current layout" and is cached as `absent`.
 * It is not a per-request error and must not be re-confirmed on every view.
 */
async function fetchPointerFromOrigin(
  blobBase: string,
  options: PointerReadOptions,
): Promise<CachedBootstrapPointer> {
  const published = options.published ?? false;
  const timeoutMs = options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS;
  const init = published
    ? {
        next: {
          revalidate: BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
          tags: [BOOTSTRAP_POINTER_CACHE_TAG],
        },
        timeoutMs,
      }
    : {
        cache: "no-store" as const,
        timeoutMs,
      };
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= POINTER_READ_RETRIES + 1; attempt++) {
    try {
      res = await fetchWithTimeout(published ? publishedPointerUrl(blobBase) : authoritativePointerUrl(blobBase), init);
    } catch (error) {
      lastError = error;
      if (attempt > POINTER_READ_RETRIES) break;
      await sleepImpl(pointerRetryDelayMs(500, attempt));
      continue;
    }
    if (res.status === 404 || res.ok) break;
    if (!shouldRetryPointerStatus(res.status) || attempt > POINTER_READ_RETRIES) break;
    await sleepImpl(pointerRetryDelayMs(res.status, attempt));
  }
  if (res?.status === 404) return { state: "absent" };
  if (res?.status === 403 || res?.status === 429 || (res != null && res.status >= 500)) {
    throw new Error(`bootstrap pointer fetch -> ${res.status}`);
  }
  if (!res?.ok) {
    const detail = res ? String(res.status) : lastError instanceof Error ? lastError.message : "no response";
    throw new Error(`bootstrap pointer fetch -> ${detail}`);
  }
  const pointer = BootstrapPublicationPointer.parse(await res.json());
  const expectedPrefix = `bootstrap/generations/${pointer.generation}`;
  if (pointer.prefix !== expectedPrefix) {
    throw new Error(`${BOOTSTRAP_POINTER_PATH}: prefix must equal ${expectedPrefix}`);
  }
  return { state: "present", pointer };
}

function cachedValue(entry: CachedBootstrapPointer): BootstrapPointer | null {
  return entry.state === "present" ? entry.pointer : null;
}

/** Read the one-file bootstrap commit point without recursing through readView. */
export async function readBootstrapPublicationPointer(
  options: PointerReadOptions = {},
): Promise<BootstrapPointer | null> {
  const blobBase = requireBlobBaseUrl();
  if (options.published) {
    const cached = await readCachedBootstrapPointer(() => fetchPointerFromOrigin(blobBase, options));
    return cachedValue(cached);
  }

  const key = `${blobBase}\0${options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS}`;
  const existing = authoritativeReads.get(key);
  if (existing) return existing;
  const pending = fetchPointerFromOrigin(blobBase, options).then(cachedValue);
  authoritativeReads.set(key, pending);
  try {
    return await pending;
  } finally {
    if (authoritativeReads.get(key) === pending) authoritativeReads.delete(key);
  }
}

export function bootstrapCanonicalOverlayPrefix(generation: string): string {
  return `bootstrap/overlays/${generation}`;
}

/**
 * Resolve a logical canonical write into the active generation's copy-on-write
 * overlay. The sealed bootstrap payload stays byte-for-byte immutable, while
 * recurring Workflow mutations remain recoverable with that generation.
 */
export async function resolveCanonicalBlobPath(path: string, timeoutMs?: number): Promise<string> {
  if (!path.startsWith("canonical/")) return path;
  const pointer = await readBootstrapPublicationPointer({ timeoutMs });
  return pointer ? `${bootstrapCanonicalOverlayPrefix(pointer.generation)}/${path}` : path;
}

/** Read overlay first, then the immutable bootstrap payload for absent keys. */
export async function resolveCanonicalReadBlobPaths(path: string, timeoutMs?: number): Promise<string[]> {
  if (!path.startsWith("canonical/")) return [path];
  const pointer = await readBootstrapPublicationPointer({ timeoutMs });
  if (!pointer) return [path];
  return [
    `${bootstrapCanonicalOverlayPrefix(pointer.generation)}/${path}`,
    `${pointer.prefix}/${path}`,
  ];
}

/** Resolve a base view only when the managed views/latest.json pointer is absent. */
export async function resolveBootstrapBaseBlobPath(path: string, timeoutMs?: number): Promise<string> {
  const pointer = await readBootstrapPublicationPointer({ published: true, timeoutMs });
  return pointer ? `${pointer.prefix}/views/${path}` : path;
}
