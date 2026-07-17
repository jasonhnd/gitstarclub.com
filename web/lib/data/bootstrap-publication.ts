import { BootstrapPublicationPointer, type BootstrapPublicationPointer as BootstrapPointer } from "@/lib/contracts";
import { BLOB_JSON_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl } from "@/lib/runtime-config";

export const BOOTSTRAP_POINTER_PATH = "bootstrap/latest.json";
const BOOTSTRAP_POINTER_REVALIDATE_SECONDS = 60;
let pointerReadSequence = 0;

// Canonical validation loads many shards concurrently. Coalesce only reads
// which are already in flight; do not retain a process-local value after the
// request settles. A newly committed or rolled-back pointer is therefore used
// by the next operation, while one Promise.all wave sees one generation.
const authoritativeReads = new Map<string, Promise<BootstrapPointer | null>>();

type PointerReadOptions = {
  /** ISR-safe for base-page fallback; authoritative reads bypass every cache. */
  published?: boolean;
  timeoutMs?: number;
};

function pointerUrl(blobBase: string, published: boolean): string {
  const token = published
    ? Math.floor(Date.now() / (BOOTSTRAP_POINTER_REVALIDATE_SECONDS * 1000))
    : `${Date.now().toString(36)}-${++pointerReadSequence}`;
  return `${blobBase}/${BOOTSTRAP_POINTER_PATH}?v=${token}`;
}

async function fetchPointer(blobBase: string, options: PointerReadOptions): Promise<BootstrapPointer | null> {
  const published = options.published ?? false;
  const res = await fetchWithTimeout(
    pointerUrl(blobBase, published),
    published
      ? {
          next: { revalidate: BOOTSTRAP_POINTER_REVALIDATE_SECONDS },
          timeoutMs: options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS,
        }
      : {
          cache: "no-store",
          timeoutMs: options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS,
        },
  );
  if (res.status === 404) return null; // confirmed legacy flat layout
  if (!res.ok) throw new Error(`bootstrap pointer fetch -> ${res.status}`);
  const pointer = BootstrapPublicationPointer.parse(await res.json());
  const expectedPrefix = `bootstrap/generations/${pointer.generation}`;
  if (pointer.prefix !== expectedPrefix) {
    throw new Error(`${BOOTSTRAP_POINTER_PATH}: prefix must equal ${expectedPrefix}`);
  }
  return pointer;
}

/** Read the one-file bootstrap commit point without recursing through readView. */
export async function readBootstrapPublicationPointer(
  options: PointerReadOptions = {},
): Promise<BootstrapPointer | null> {
  const blobBase = requireBlobBaseUrl();
  if (options.published) return fetchPointer(blobBase, options);

  const key = `${blobBase}\0${options.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS}`;
  const existing = authoritativeReads.get(key);
  if (existing) return existing;
  const pending = fetchPointer(blobBase, options);
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
