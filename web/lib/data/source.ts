import type { ZodType } from "zod";
import { LiveGenerationPointer } from "@/lib/contracts";
import { BLOB_JSON_FETCH_TIMEOUT_MS, FetchTimeoutError, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl } from "@/lib/runtime-config";
import { PUBLISHED_VIEWS_CACHE_TAG, PUBLICATION_VISIBILITY_SLA_MS } from "@/lib/data/publication-cache-contract";

// View source: reads JSON views by direct URL from the Vercel Blob store (public).
// BLOB_BASE_URL must point at the store base (set in Vercel project env + local .env.local).
// Base views resolve through the publish pointer (views/latest.json → views/<version>/<path>)
// with a flat-layout fallback, so the read side serves the validated version and rollback is a
// single pointer write. Live overlays resolve independently through live/latest.json to one
// complete immutable generation. Canonical / ops reads stay flat.
// See docs/OPS.md (Blob layout), docs/FRONTEND.md §3, docs/VERCEL-DATA-OPERATIONS.md §7.

export interface ViewOpts {
  /** Cache-bust token for daily-updated views (current_month / hot-snapshot); see OPS §Blob. */
  bust?: string;
  /** Resolve via the publish pointer (views/latest.json → views/<version>/<path>), with a flat
   *  fallback when no pointer exists. Base views only — never live/*, canonical/*, or ops/*. */
  base?: boolean;
  /** Override publish-pointer freshness for special read paths such as sitemap generation. */
  versionTtlMs?: number;
  /** Resolve a logical live-overlay path through live/latest.json. A 404 pointer
   * falls back to `legacyPath` during migration; an unreachable/invalid pointer
   * fails closed unless a previously validated generation is cached. */
  live?: boolean;
  /** Pre-generation flat path used only when live/latest.json does not exist. */
  legacyPath?: string;
  /** Override live pointer freshness (default 60 seconds). */
  liveTtlMs?: number;
  /** Override the per-request Blob JSON timeout. */
  timeoutMs?: number;
}

const VERSION_TTL_MS = 3_600_000;
export const LIVE_POINTER_TTL_MS = 60_000;
export const DAILY_BASE_VIEW_TTL_MS = 86_400_000;
export const DAILY_BASE_VIEW_OPTS = { base: true, versionTtlMs: DAILY_BASE_VIEW_TTL_MS } as const satisfies ViewOpts;
const READ_RETRIES = 2;
const versionMemo = new Map<string, { version: string | null; at: number }>();
let mutableReadSequence = 0;
const liveGenerationMemo = new Map<string, { generation: string | null; at: number }>();
const liveGenerationInflight = new Map<string, Promise<string | null>>();

/** Clear this process's pointer memo after a publish/rollback in the same runtime. */
export function invalidatePublishedVersionMemo(): void {
  versionMemo.clear();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  return Math.min(250 * 2 ** (attempt - 1), 2_000);
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Resolve the live published version from views/latest.json (≤1h stale). null → flat fallback. */
async function resolveVersion(blobBase: string, ttlMs = VERSION_TTL_MS, timeoutMs = BLOB_JSON_FETCH_TIMEOUT_MS): Promise<string | null> {
  const now = Date.now();
  const memoKey = `${blobBase}\0${ttlMs}`;
  const memo = versionMemo.get(memoKey);
  // Long-lived pages may use a 24h data-cache TTL, but a process-local memo must
  // never extend the publication visibility SLA. The publisher invalidates the
  // shared Next cache tag; cold/other instances catch up within this bound.
  if (memo && now - memo.at < Math.min(ttlMs, PUBLICATION_VISIBILITY_SLA_MS)) return memo.version;
  let version: string | null = null;
  if (blobBase) {
    try {
      // Revalidated, NOT no-store: a `no-store` fetch flips an on-demand-ISR page to dynamic at
      // render time ("Page changed from static to dynamic at runtime" → 500 on the first cold
      // generation, before the in-memory memo warms). A revalidated fetch keeps bounded pointer
      // freshness while staying static/ISR-safe. The rotating ?v= still busts the Blob CDN.
      const res = await fetchWithTimeout(`${blobBase}/views/latest.json?v=${Math.floor(now / ttlMs)}`, {
        next: { revalidate: ttlMs / 1000, tags: [PUBLISHED_VIEWS_CACHE_TAG] },
        timeoutMs,
      });
      if (res.ok) {
        const j = (await res.json()) as { version?: unknown };
        if (typeof j.version === "string") version = j.version;
      }
    } catch {
      version = null; // pointer unreachable → flat fallback (never break the read path)
    }
  }
  versionMemo.set(memoKey, { version, at: now });
  return version;
}

/** Resolve the last complete live generation. Only a real 404 enables the
 * legacy flat-layout fallback. Transient failures reuse a previously validated
 * generation, or fail closed when no safe generation is known. */
async function resolveLiveGeneration(
  blobBase: string,
  ttlMs = LIVE_POINTER_TTL_MS,
  timeoutMs = BLOB_JSON_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const now = Date.now();
  const memoKey = `${blobBase}\0${ttlMs}`;
  const memo = liveGenerationMemo.get(memoKey);
  if (memo && now - memo.at < ttlMs) return memo.generation;
  const inflight = liveGenerationInflight.get(memoKey);
  if (inflight) return inflight;

  const resolving = (async () => {
    try {
      const res = await fetchWithTimeout(`${blobBase}/live/latest.json?v=${Math.floor(now / ttlMs)}`, {
        next: { revalidate: ttlMs / 1000 },
        timeoutMs,
      });
      if (res.status === 404) {
        liveGenerationMemo.set(memoKey, { generation: null, at: now });
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pointer = LiveGenerationPointer.parse(await res.json());
      liveGenerationMemo.set(memoKey, { generation: pointer.generation, at: now });
      return pointer.generation;
    } catch (error) {
      // A stale, already validated generation remains a safe complete snapshot.
      // Never guess the legacy flat layout after a pointer/network error.
      if (memo?.generation) return memo.generation;
      const detail = fetchErrorDetail(error);
      throw new Error(`live pointer fetch -> ${detail}`);
    } finally {
      liveGenerationInflight.delete(memoKey);
    }
  })();
  liveGenerationInflight.set(memoKey, resolving);
  return resolving;
}

async function rawRead(path: string, opts: ViewOpts): Promise<unknown | null> {
  const blobBase = requireBlobBaseUrl();
  let key = path;
  let bust = opts.bust;
  const timeoutMs = opts.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS;
  if (opts.base && opts.live) throw new Error("a view cannot be both base and live");
  if (opts.base) {
    const version = await resolveVersion(blobBase, opts.versionTtlMs, timeoutMs);
    if (version) {
      key = `views/${version}/${path}`;
      bust ??= version; // versioned path is immutable
    }
  } else if (opts.live) {
    const generation = await resolveLiveGeneration(blobBase, opts.liveTtlMs, timeoutMs);
    if (generation) {
      key = `live/generations/${generation}/${path}`;
      bust = generation; // immutable path; pointer is the only mutable object
    } else {
      key = opts.legacyPath ?? path;
    }
  }
  const mutableWorkflowArtifact =
    key.startsWith("canonical/") || key.startsWith("ops/") || key === "views/latest.json";
  // no-store bypasses the framework cache; a per-read query also bypasses the
  // public Blob CDN's short overwrite cache so a same-run read cannot receive
  // the value that existed immediately before its own write.
  if (mutableWorkflowArtifact) bust = `${Date.now().toString(36)}-${++mutableReadSequence}`;
  const url = `${blobBase}/${key}${bust ? `?v=${encodeURIComponent(bust)}` : ""}`;
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
    try {
      res = await fetchWithTimeout(url, { cache: mutableWorkflowArtifact ? "no-store" : "force-cache", timeoutMs });
    } catch (err) {
      lastError = err;
      if (attempt > READ_RETRIES) break;
      await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000));
      continue;
    }
    if (res.status === 404) return null;
    if (res.ok) break;
    if (!shouldRetry(res.status) || attempt > READ_RETRIES) break;
    await sleep(retryDelayMs(res, attempt));
  }
  if (!res?.ok) {
    const detail = res ? String(res.status) : fetchErrorDetail(lastError);
    throw new Error(`view fetch ${key} -> ${detail}`);
  }
  return res.json();
}

function fetchErrorDetail(error: unknown): string {
  if (error instanceof FetchTimeoutError) return `timeout after ${error.timeoutMs}ms`;
  return error instanceof Error ? error.message : "no response";
}

/** Read + Zod-validate a view. Returns null when the view is absent (caller → notFound()). */
export async function readView<T>(path: string, schema: ZodType<T>, opts: ViewOpts = {}): Promise<T | null> {
  const json = await rawRead(path, opts);
  return json === null ? null : schema.parse(json);
}
