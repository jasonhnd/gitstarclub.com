import type { ZodType } from "zod";
import { BLOB_JSON_FETCH_TIMEOUT_MS, FetchTimeoutError, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl } from "@/lib/runtime-config";

// View source: reads JSON views by direct URL from the Vercel Blob store (public).
// BLOB_BASE_URL must point at the store base (set in Vercel project env + local .env.local).
// Base views resolve through the publish pointer (views/latest.json → views/<version>/<path>)
// with a flat-layout fallback, so the read side serves the validated version and rollback is a
// single pointer write. Live-overlay / canonical / ops reads stay flat (base:false).
// See docs/OPS.md (Blob layout), docs/FRONTEND.md §3, docs/VERCEL-DATA-OPERATIONS.md §7.

export interface ViewOpts {
  /** Cache-bust token for daily-updated views (current_month / hot-snapshot); see OPS §Blob. */
  bust?: string;
  /** Resolve via the publish pointer (views/latest.json → views/<version>/<path>), with a flat
   *  fallback when no pointer exists. Base views only — never live/*, canonical/*, or ops/*. */
  base?: boolean;
  /** Override publish-pointer freshness for special read paths such as sitemap generation. */
  versionTtlMs?: number;
  /** Override the per-request Blob JSON timeout. */
  timeoutMs?: number;
}

const VERSION_TTL_MS = 3_600_000;
export const DAILY_BASE_VIEW_TTL_MS = 86_400_000;
export const DAILY_BASE_VIEW_OPTS = { base: true, versionTtlMs: DAILY_BASE_VIEW_TTL_MS } as const satisfies ViewOpts;
const READ_RETRIES = 2;
const versionMemo = new Map<string, { version: string | null; at: number }>();

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
  if (memo && now - memo.at < ttlMs) return memo.version;
  let version: string | null = null;
  if (blobBase) {
    try {
      // Revalidated, NOT no-store: a `no-store` fetch flips an on-demand-ISR page to dynamic at
      // render time ("Page changed from static to dynamic at runtime" → 500 on the first cold
      // generation, before the in-memory memo warms). A revalidated fetch keeps bounded pointer
      // freshness while staying static/ISR-safe. The rotating ?v= still busts the Blob CDN.
      const res = await fetchWithTimeout(`${blobBase}/views/latest.json?v=${Math.floor(now / ttlMs)}`, {
        next: { revalidate: ttlMs / 1000 },
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

async function rawRead(path: string, opts: ViewOpts): Promise<unknown | null> {
  const blobBase = requireBlobBaseUrl();
  let key = path;
  let bust = opts.bust;
  const timeoutMs = opts.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS;
  if (opts.base) {
    const version = await resolveVersion(blobBase, opts.versionTtlMs, timeoutMs);
    if (version) {
      key = `views/${version}/${path}`;
      bust ??= version; // versioned path is immutable
    }
  }
  const url = `${blobBase}/${key}${bust ? `?v=${encodeURIComponent(bust)}` : ""}`;
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
    try {
      res = await fetchWithTimeout(url, { cache: "force-cache", timeoutMs });
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
