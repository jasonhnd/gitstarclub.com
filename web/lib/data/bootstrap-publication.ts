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

async function fetchPointerFromOrigin(
  blobBase: string,
  options: PointerReadOptions,
): Promise<CachedBootstrapPointer> {
  const published = options.published ?? false;
  const res = await fetchWithTimeout(
    published ? publishedPointerUrl(blobBase) : authoritativePointerUrl(blobBase),
    published
      ? {
          next: {
            revalidate: BOOTSTRAP_POINTER_NEGATIVE_TTL_SECONDS,
            tags: [BOOTSTRAP_POINTER_CACHE_TAG],
          },
          timeoutMs: options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS,
        }
      : {
          cache: "no-store",
          timeoutMs: options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS,
        },
  );
  if (res.status === 404) return { state: "absent" };
  if (res.status === 403 || res.status === 429 || res.status >= 500) {
    throw new Error(`bootstrap pointer fetch -> ${res.status}`);
  }
  if (!res.ok) throw new Error(`bootstrap pointer fetch -> ${res.status}`);
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
