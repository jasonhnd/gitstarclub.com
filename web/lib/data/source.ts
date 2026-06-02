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
}

const VERSION_TTL_MS = 60_000;
let versionMemo: { version: string | null; at: number } | null = null;

/** Resolve the live published version from views/latest.json (≤60s stale). null → flat fallback. */
async function resolveVersion(): Promise<string | null> {
  const now = Date.now();
  if (versionMemo && now - versionMemo.at < VERSION_TTL_MS) return versionMemo.version;
  let version: string | null = null;
  if (BLOB_BASE) {
    try {
      const res = await fetch(`${BLOB_BASE}/views/latest.json?v=${Math.floor(now / VERSION_TTL_MS)}`, { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { version?: unknown };
        if (typeof j.version === "string") version = j.version;
      }
    } catch {
      version = null; // pointer unreachable → flat fallback (never break the read path)
    }
  }
  versionMemo = { version, at: now };
  return version;
}

async function rawRead(path: string, opts: ViewOpts): Promise<unknown | null> {
  if (!BLOB_BASE) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  let key = path;
  let bust = opts.bust;
  if (opts.base) {
    const version = await resolveVersion();
    if (version) {
      key = `views/${version}/${path}`;
      bust ??= version; // versioned path is immutable
    }
  }
  const url = `${BLOB_BASE}/${key}${bust ? `?v=${encodeURIComponent(bust)}` : ""}`;
  const res = await fetch(url, { cache: "force-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`view fetch ${key} → ${res.status}`);
  return res.json();
}

/** Read + Zod-validate a view. Returns null when the view is absent (caller → notFound()). */
export async function readView<T>(path: string, schema: ZodType<T>, opts: ViewOpts = {}): Promise<T | null> {
  const json = await rawRead(path, opts);
  return json === null ? null : schema.parse(json);
}
