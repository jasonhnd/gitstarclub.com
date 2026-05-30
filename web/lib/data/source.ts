import type { ZodType } from "zod";

// View source: reads JSON views by direct URL from the Vercel Blob store (public).
// BLOB_BASE_URL must point at the store base (set in Vercel project env + local .env.local).
// See docs/OPS.md (Blob layout) and docs/FRONTEND.md §3.

const BLOB_BASE = (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");

export interface ViewOpts {
  /** Cache-bust token for daily-updated views (current_month / hot-snapshot); see OPS §Blob. */
  bust?: string;
}

async function rawRead(path: string, opts: ViewOpts): Promise<unknown | null> {
  if (!BLOB_BASE) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  const url = `${BLOB_BASE}/${path}${opts.bust ? `?v=${encodeURIComponent(opts.bust)}` : ""}`;
  const res = await fetch(url, { cache: "force-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`view fetch ${path} → ${res.status}`);
  return res.json();
}

/** Read + Zod-validate a view. Returns null when the view is absent (caller → notFound()). */
export async function readView<T>(path: string, schema: ZodType<T>, opts: ViewOpts = {}): Promise<T | null> {
  const json = await rawRead(path, opts);
  return json === null ? null : schema.parse(json);
}
