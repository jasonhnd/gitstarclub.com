import type { ZodType } from "zod";

// View source: reads JSON views by direct URL from the Vercel Blob store (public).
// BLOB_BASE_URL must point at the store base (set in Vercel project env + local .env.local).
// Base views resolve through the publish pointer (views/latest.json → views/<version>/<path>)
// with a flat-layout fallback, so the read side serves the validated version and rollback is a
// single pointer write. Live-overlay / canonical / ops reads stay flat (base:false).
// See docs/OPS.md (Blob layout), docs/FRONTEND.md §3, docs/VERCEL-DATA-OPERATIONS.md §7.

const BLOB_BASE = (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");

export interface ViewOpts {
  /** Cache-bust token for daily-updated views (current_month / hot-snapshot); see OPS §Blob. */
  bust?: string;
  /** Resolve via the publish pointer (views/latest.json → views/<version>/<path>), with a flat
   *  fallback when no pointer exists. Base views only — never live/*, canonical/*, or ops/*. */
  base?: boolean;
  /** Override publish-pointer freshness for special read paths such as sitemap generation. */
  versionTtlMs?: number;
}

const VERSION_TTL_MS = 3_600_000;
const READ_RETRIES = 2;
const versionMemo = new Map<number, { version: string | null; at: number }>();

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
async function resolveVersion(ttlMs = VERSION_TTL_MS): Promise<string | null> {
  const now = Date.now();
  const memo = versionMemo.get(ttlMs);
  if (memo && now - memo.at < ttlMs) return memo.version;
  let version: string | null = null;
  if (BLOB_BASE) {
    try {
      // Revalidated, NOT no-store: a `no-store` fetch flips an on-demand-ISR page to dynamic at
      // render time ("Page changed from static to dynamic at runtime" → 500 on the first cold
      // generation, before the in-memory memo warms). A revalidated fetch keeps bounded pointer
      // freshness while staying static/ISR-safe. The rotating ?v= still busts the Blob CDN.
      const res = await fetch(`${BLOB_BASE}/views/latest.json?v=${Math.floor(now / ttlMs)}`, {
        next: { revalidate: ttlMs / 1000 },
      });
      if (res.ok) {
        const j = (await res.json()) as { version?: unknown };
        if (typeof j.version === "string") version = j.version;
      }
    } catch {
      version = null; // pointer unreachable → flat fallback (never break the read path)
    }
  }
  versionMemo.set(ttlMs, { version, at: now });
  return version;
}

async function rawRead(path: string, opts: ViewOpts): Promise<unknown | null> {
  if (!BLOB_BASE) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  let key = path;
  let bust = opts.bust;
  if (opts.base) {
    const version = await resolveVersion(opts.versionTtlMs);
    if (version) {
      key = `views/${version}/${path}`;
      bust ??= version; // versioned path is immutable
    }
  }
  const url = `${BLOB_BASE}/${key}${bust ? `?v=${encodeURIComponent(bust)}` : ""}`;
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
    try {
      res = await fetch(url, { cache: "force-cache" });
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
    const detail = res ? String(res.status) : lastError instanceof Error ? lastError.message : "no response";
    throw new Error(`view fetch ${key} -> ${detail}`);
  }
  return res.json();
}

/** Read + Zod-validate a view. Returns null when the view is absent (caller → notFound()). */
export async function readView<T>(path: string, schema: ZodType<T>, opts: ViewOpts = {}): Promise<T | null> {
  const json = await rawRead(path, opts);
  return json === null ? null : schema.parse(json);
}
