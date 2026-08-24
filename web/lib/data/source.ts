import type { ZodType } from "zod";
import { LiveGenerationPointer } from "@/lib/contracts";
import { BLOB_JSON_FETCH_TIMEOUT_MS, FetchTimeoutError, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl } from "@/lib/runtime-config";
import { PUBLISHED_VIEWS_CACHE_TAG, PUBLICATION_VISIBILITY_SLA_MS } from "@/lib/data/publication-cache-contract";
import {
  invalidateBootstrapPointerCache,
  readBootstrapPublicationPointer,
  resolveBootstrapBaseBlobPath,
  resolveCanonicalReadBlobPaths,
} from "@/lib/data/bootstrap-publication";
import { resolveLiveArtifactFromHistory } from "@/lib/data/live-generation-history";
import { parseView } from "@/lib/data/parse-view";

// View source: reads JSON views by direct URL from the Vercel Blob store (public).
// BLOB_BASE_URL must point at the store base (set in Vercel project env + local .env.local).
// Base views compare the managed and bootstrap publication timestamps, then use the newest
// complete generation; when neither pointer exists they use the legacy flat layout. Canonical
// reads resolve through bootstrap/latest.json. Live overlays resolve independently through
// live/latest.json to one complete immutable generation. Period-scoped views may walk the
// validated immutable generation history until base folding catches up. Every publication
// switches with one pointer write; operational reads remain flat.
// See docs/OPS.md (Blob layout), docs/FRONTEND.md §3, docs/VERCEL-DATA-OPERATIONS.md §7.

export interface ViewOpts {
  /** Cache-bust token for daily-updated views (current_month / hot-snapshot); see OPS §Blob. */
  bust?: string;
  /** Resolve the newest managed/bootstrap generation, then legacy flat when neither exists.
   *  Base views only — never live/*, canonical/*, or ops/*. */
  base?: boolean;
  /** Override publish-pointer freshness for special read paths such as sitemap generation. */
  versionTtlMs?: number;
  /** Resolve a logical live-overlay path through live/latest.json. A 404 pointer
   * falls back to `legacyPath` during migration. An unreachable/invalid pointer
   * reuses a previously validated generation; otherwise published reads omit
   * the live overlay while authoritative reads fail closed. */
  live?: boolean;
  /** For immutable period-scoped rank/heatmap views only: after a current-generation
   * 404, walk validated manifest previous_generation links with a bounded depth. */
  liveHistory?: boolean;
  /** Pre-generation flat path. Snapshot reads use it only when live/latest.json
   * does not exist; liveHistory reads use it after a valid chain is exhausted. */
  legacyPath?: string;
  /** Override live pointer freshness (default 60 seconds). */
  liveTtlMs?: number;
  /** Override the per-request Blob JSON timeout. */
  timeoutMs?: number;
  /**
   * Skip Next.js Data Cache for this Blob GET. Use only on already-dynamic
   * routes (cron, `/search-index`) where the Blob/CDN cache is the real cache.
   * Never set this on ISR pages: `no-store` flips the page to dynamic at runtime.
   */
  skipNextDataCache?: boolean;
}

const VERSION_TTL_MS = 3_600_000;
export const LIVE_POINTER_TTL_MS = 60_000;
export const DAILY_BASE_VIEW_TTL_MS = 86_400_000;
export const DAILY_BASE_VIEW_OPTS = { base: true, versionTtlMs: DAILY_BASE_VIEW_TTL_MS } as const satisfies ViewOpts;
// Extra retries absorb intermittent Vercel Blob WAF 403s (`x-vercel-mitigated: deny`)
// observed during large preview SSG (thousands of concurrent public CDN reads).
const READ_RETRIES = 4;
const LIVE_HISTORY_FORBIDDEN_RETRIES = 1;
const LIVE_HISTORY_FORBIDDEN_TTL_MS = 60_000;
type VersionResolution = { version: string | null; publishedAt: string | null; confirmedAbsent: boolean };
type ReadMode = "published" | "authoritative";
const versionMemo = new Map<string, VersionResolution & { at: number }>();
let mutableReadSequence = 0;
const liveGenerationMemo = new Map<string, { generation: string | null; at: number }>();
const liveGenerationInflight = new Map<string, Promise<string | null>>();
const liveGenerationFailureMemo = new Map<string, { error: Error; at: number }>();
const liveManifestMemo = new Map<string, Promise<unknown | null>>();
const liveHistoryForbiddenMemo = new Map<string, number>();
const MAX_LIVE_POINTER_FAILURE_MEMO_ENTRIES = 32;
const MAX_LIVE_MANIFEST_MEMO_ENTRIES = 256;
const MAX_LIVE_HISTORY_FORBIDDEN_MEMO_ENTRIES = 256;

class StrictBlobReadForbiddenError extends Error {
  constructor(key: string) {
    super(`view fetch ${key} -> 403`);
    this.name = "StrictBlobReadForbiddenError";
  }
}

/** Clear this process's pointer memo after a publish/rollback in the same runtime. */
export function invalidatePublishedVersionMemo(): void {
  versionMemo.clear();
  invalidateBootstrapPointerCache();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers?.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  // 403 from Blob WAF is often a short deny; back off a bit longer than ordinary 5xx.
  if (res.status === 403) return Math.min(400 * 2 ** (attempt - 1), 3_000);
  return Math.min(250 * 2 ** (attempt - 1), 2_000);
}

function shouldRetry(status: number): boolean {
  // 403: public Blob CDN occasionally returns WAF denials under SSG load.
  return status === 403 || status === 429 || status >= 500;
}

async function readBlobJsonKey(args: {
  blobBase: string;
  key: string;
  bust?: string;
  timeoutMs: number;
  mutableWorkflowArtifact: boolean;
  skipNextDataCache?: boolean;
  allowForbiddenAsMissing?: boolean;
  forbiddenRetries?: number;
}): Promise<unknown | null> {
  const {
    blobBase,
    key,
    bust,
    timeoutMs,
    mutableWorkflowArtifact,
    skipNextDataCache = false,
    allowForbiddenAsMissing = true,
    forbiddenRetries = READ_RETRIES,
  } = args;
  const url = `${blobBase}/${key}${bust ? `?v=${encodeURIComponent(bust)}` : ""}`;
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
    try {
      res = await fetchWithTimeout(url, {
        cache: mutableWorkflowArtifact || skipNextDataCache ? "no-store" : "force-cache",
        timeoutMs,
      });
    } catch (err) {
      lastError = err;
      if (attempt > READ_RETRIES) break;
      await sleep(Math.min(250 * 2 ** (attempt - 1), 2_000));
      continue;
    }
    if (res.status === 404 || res.ok) break;
    const retryLimit = res.status === 403 ? forbiddenRetries : READ_RETRIES;
    if (!shouldRetry(res.status) || attempt > retryLimit) break;
    await sleep(retryDelayMs(res, attempt));
  }
  if (res?.status === 404) return null;
  // Published page reads tolerate a persistent Blob WAF denial during SSG.
  // Strict history and authoritative reads disable that tolerance: denied
  // current bytes must not silently select older or sealed bytes.
  if (res?.status === 403) {
    if (allowForbiddenAsMissing) return null;
    throw new StrictBlobReadForbiddenError(key);
  }
  if (!res?.ok) {
    const detail = res ? String(res.status) : fetchErrorDetail(lastError);
    throw new Error(`view fetch ${key} -> ${detail}`);
  }
  return res.json();
}

async function readLiveHistoryJsonKey(args: {
  blobBase: string;
  key: string;
  bust?: string;
  timeoutMs: number;
}): Promise<unknown | null> {
  const { blobBase, key, bust, timeoutMs } = args;
  const memoKey = `${blobBase}\0${key}`;
  const forbiddenUntil = liveHistoryForbiddenMemo.get(memoKey);
  if (forbiddenUntil !== undefined) {
    if (forbiddenUntil > Date.now()) throw new StrictBlobReadForbiddenError(key);
    liveHistoryForbiddenMemo.delete(memoKey);
  }
  try {
    return await readBlobJsonKey({
      blobBase,
      key,
      bust,
      timeoutMs,
      mutableWorkflowArtifact: false,
      allowForbiddenAsMissing: false,
      forbiddenRetries: LIVE_HISTORY_FORBIDDEN_RETRIES,
    });
  } catch (error) {
    if (error instanceof StrictBlobReadForbiddenError) {
      liveHistoryForbiddenMemo.set(memoKey, Date.now() + LIVE_HISTORY_FORBIDDEN_TTL_MS);
      if (liveHistoryForbiddenMemo.size > MAX_LIVE_HISTORY_FORBIDDEN_MEMO_ENTRIES) {
        const oldest = liveHistoryForbiddenMemo.keys().next().value;
        if (typeof oldest === "string" && oldest !== memoKey) liveHistoryForbiddenMemo.delete(oldest);
      }
    }
    throw error;
  }
}

function readLiveGenerationManifest(
  blobBase: string,
  generation: string,
  timeoutMs: number,
): Promise<unknown | null> {
  const memoKey = `${blobBase}\0${generation}`;
  const memo = liveManifestMemo.get(memoKey);
  if (memo) return memo;
  const key = `live/generations/${generation}/manifest.json`;
  const reading = readLiveHistoryJsonKey({
    blobBase,
    key,
    bust: generation,
    timeoutMs,
  });
  const retained = reading.then(
    (value) => {
      if (value === null) liveManifestMemo.delete(memoKey);
      return value;
    },
    (error) => {
      liveManifestMemo.delete(memoKey);
      throw error;
    },
  );
  liveManifestMemo.set(memoKey, retained);
  if (liveManifestMemo.size > MAX_LIVE_MANIFEST_MEMO_ENTRIES) {
    const oldest = liveManifestMemo.keys().next().value;
    if (typeof oldest === "string" && oldest !== memoKey) liveManifestMemo.delete(oldest);
  }
  return retained;
}

/** Resolve views/latest; only a confirmed 404 is allowed to activate bootstrap fallback. */
async function resolveVersion(
  blobBase: string,
  ttlMs = VERSION_TTL_MS,
  timeoutMs = BLOB_JSON_FETCH_TIMEOUT_MS,
  mode: ReadMode = "published",
): Promise<VersionResolution> {
  const now = Date.now();
  const memoKey = `${blobBase}\0${ttlMs}\0${mode}`;
  const memo = versionMemo.get(memoKey);
  // Long-lived pages may use a 24h data-cache TTL, but a process-local memo must
  // never extend the publication visibility SLA. The publisher invalidates the
  // shared Next cache tag; cold/other instances catch up within this bound.
  if (memo && now - memo.at < Math.min(ttlMs, PUBLICATION_VISIBILITY_SLA_MS)) {
    return { version: memo.version, publishedAt: memo.publishedAt, confirmedAbsent: memo.confirmedAbsent };
  }
  const resolution: VersionResolution = { version: null, publishedAt: null, confirmedAbsent: false };
  if (blobBase) {
    try {
      // Revalidated, NOT no-store: a `no-store` fetch flips an on-demand-ISR page to dynamic at
      // render time ("Page changed from static to dynamic at runtime" → 500 on the first cold
      // generation, before the in-memory memo warms). A revalidated fetch keeps bounded pointer
      // freshness while staying static/ISR-safe. The rotating ?v= still busts the Blob CDN.
      let res: Response | null = null;
      for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
        res = await fetchWithTimeout(`${blobBase}/views/latest.json?v=${Math.floor(now / ttlMs)}`, {
          next: { revalidate: ttlMs / 1000, tags: [PUBLISHED_VIEWS_CACHE_TAG] },
          timeoutMs,
        });
        if (res.ok || res.status === 404 || !shouldRetry(res.status) || attempt > READ_RETRIES) break;
        await sleep(retryDelayMs(res, attempt));
      }
      if (res?.ok) {
        const j = (await res.json()) as { version?: unknown; published_at?: unknown };
        if (typeof j.version === "string") resolution.version = j.version;
        if (typeof j.published_at === "string" && Number.isFinite(Date.parse(j.published_at))) {
          resolution.publishedAt = j.published_at;
        }
        if (mode === "authoritative" && resolution.version === null) {
          throw new Error("missing version");
        }
      } else if (res?.status === 404) {
        resolution.confirmedAbsent = true;
      } else if (mode === "authoritative") {
        throw new Error(res ? `HTTP ${res.status}` : "no response");
      }
    } catch (error) {
      if (mode === "authoritative") {
        throw new Error(`views pointer fetch -> ${fetchErrorDetail(error)}`, { cause: error });
      }
      // Pointer unreachable: preserve the legacy flat fallback, but never jump
      // to an older bootstrap generation unless absence was confirmed by 404.
    }
  }
  versionMemo.set(memoKey, { ...resolution, at: now });
  return resolution;
}

/** Resolve the last complete live generation. Only a real 404 enables the
 * legacy flat-layout fallback. Transient failures reuse a previously validated
 * generation, or throw when no safe generation is known. The short failure
 * memo prevents every page in one SSG worker from repeating the same backoff. */
async function resolveLiveGeneration(
  blobBase: string,
  ttlMs = LIVE_POINTER_TTL_MS,
  timeoutMs = BLOB_JSON_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  const now = Date.now();
  const memoKey = `${blobBase}\0${ttlMs}`;
  const memo = liveGenerationMemo.get(memoKey);
  if (memo && now - memo.at < ttlMs) return memo.generation;
  const failed = liveGenerationFailureMemo.get(memoKey);
  if (failed) {
    if (now - failed.at < ttlMs) throw failed.error;
    liveGenerationFailureMemo.delete(memoKey);
  }
  const inflight = liveGenerationInflight.get(memoKey);
  if (inflight) return inflight;

  const resolving = (async () => {
    try {
      let res: Response | null = null;
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= READ_RETRIES + 1; attempt++) {
        try {
          res = await fetchWithTimeout(`${blobBase}/live/latest.json?v=${Math.floor(now / ttlMs)}`, {
            next: { revalidate: ttlMs / 1000 },
            timeoutMs,
          });
        } catch (err) {
          lastError = err;
          if (attempt > READ_RETRIES) break;
          await sleep(Math.min(400 * 2 ** (attempt - 1), 3_000));
          continue;
        }
        if (res.status === 404 || res.ok) break;
        if (!shouldRetry(res.status) || attempt > READ_RETRIES) break;
        await sleep(retryDelayMs(res, attempt));
      }
      if (!res) throw lastError instanceof Error ? lastError : new Error("no response");
      if (res.status === 404) {
        liveGenerationFailureMemo.delete(memoKey);
        liveGenerationMemo.set(memoKey, { generation: null, at: now });
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const pointer = LiveGenerationPointer.parse(await res.json());
      liveGenerationFailureMemo.delete(memoKey);
      liveGenerationMemo.set(memoKey, { generation: pointer.generation, at: now });
      return pointer.generation;
    } catch (error) {
      // A stale, already validated generation remains a safe complete snapshot.
      // Never guess the legacy flat layout after a pointer/network error.
      if (memo?.generation) {
        liveGenerationMemo.set(memoKey, { generation: memo.generation, at: now });
        return memo.generation;
      }
      const detail = fetchErrorDetail(error);
      const failure = new Error(`live pointer fetch -> ${detail}`);
      liveGenerationFailureMemo.set(memoKey, { error: failure, at: now });
      if (liveGenerationFailureMemo.size > MAX_LIVE_POINTER_FAILURE_MEMO_ENTRIES) {
        const oldest = liveGenerationFailureMemo.keys().next().value;
        if (typeof oldest === "string" && oldest !== memoKey) liveGenerationFailureMemo.delete(oldest);
      }
      throw failure;
    } finally {
      liveGenerationInflight.delete(memoKey);
    }
  })();
  liveGenerationInflight.set(memoKey, resolving);
  return resolving;
}

async function rawRead(path: string, opts: ViewOpts, mode: ReadMode): Promise<unknown | null> {
  const blobBase = requireBlobBaseUrl();
  let keys = [path];
  let bust = opts.bust;
  const timeoutMs = opts.timeoutMs ?? BLOB_JSON_FETCH_TIMEOUT_MS;
  if (opts.base && opts.live) throw new Error("a view cannot be both base and live");
  if (opts.liveHistory && !opts.live) throw new Error("liveHistory requires live:true");
  if (opts.base) {
    const { version, publishedAt, confirmedAbsent } = await resolveVersion(
      blobBase,
      opts.versionTtlMs,
      timeoutMs,
      mode,
    );
    if (version) {
      let bootstrap = null;
      try {
        bootstrap = await readBootstrapPublicationPointer({ published: true, timeoutMs });
      } catch (error) {
        if (mode === "authoritative") throw error;
        // A valid managed pointer is a complete fallback if the bootstrap
        // pointer is unavailable; never degrade to legacy flat in this case.
      }
      if (
        bootstrap !== null &&
        publishedAt !== null &&
        Date.parse(bootstrap.published_at) > Date.parse(publishedAt)
      ) {
        keys = [`${bootstrap.prefix}/views/${path}`];
        bust ??= bootstrap.generation;
      } else {
        keys = [`views/${version}/${path}`];
        bust ??= version; // versioned path is immutable
      }
    } else if (confirmedAbsent) {
      const key = await resolveBootstrapBaseBlobPath(path, timeoutMs);
      keys = [key];
      if (key !== path) bust ??= key.split("/")[2];
    }
  } else if (opts.live) {
    let generation: string | null;
    try {
      generation = await resolveLiveGeneration(blobBase, opts.liveTtlMs, timeoutMs);
    } catch (error) {
      // A pointer transport/WAF failure is not proof that the migration-era
      // flat layout is safe. Published pages omit this live overlay so their
      // caller can render base/empty-state data; mutation inputs still abort.
      if (mode === "published") return null;
      throw error;
    }
    if (opts.liveHistory) {
      try {
        const resolved = await resolveLiveArtifactFromHistory({
          headGeneration: generation,
          logicalPath: path,
          legacyPath: opts.legacyPath,
          reader: {
            readGenerationArtifact: (candidateGeneration, logicalPath) =>
              readLiveHistoryJsonKey({
                blobBase,
                key: `live/generations/${candidateGeneration}/${logicalPath}`,
                bust: candidateGeneration,
                timeoutMs,
              }),
            readGenerationManifest: (candidateGeneration) =>
              readLiveGenerationManifest(blobBase, candidateGeneration, timeoutMs),
            readLegacyArtifact: (legacyPath) =>
              readLiveHistoryJsonKey({
                blobBase,
                key: legacyPath,
                bust: opts.bust,
                timeoutMs,
              }),
          },
        });
        return resolved?.value ?? null;
      } catch (error) {
        // A persistent public-CDN WAF denial during high-concurrency SSG is not
        // confirmed absence and therefore must never advance to an older live
        // generation. Stop the live lookup so callers can use base/notFound,
        // matching the existing published-page resilience without stale bytes.
        if (mode === "published" && error instanceof StrictBlobReadForbiddenError) return null;
        throw error;
      }
    }
    if (generation) {
      keys = [`live/generations/${generation}/${path}`];
      bust ??= generation; // immutable path; pointer is the only mutable object
    } else {
      keys = [opts.legacyPath ?? path];
    }
  } else if (path.startsWith("canonical/")) {
    keys = await resolveCanonicalReadBlobPaths(path, timeoutMs);
  }
  const mutableWorkflowArtifact =
    path.startsWith("canonical/") ||
    path.startsWith("ops/") ||
    path === "views/latest.json" ||
    path === "bootstrap/latest.json";
  // no-store bypasses the framework cache; a per-read query also bypasses the
  // public Blob CDN's short overwrite cache so a same-run read cannot receive
  // the value that existed immediately before its own write.
  if (mutableWorkflowArtifact) bust = `${Date.now().toString(36)}-${++mutableReadSequence}`;
  for (const key of keys) {
    const value = await readBlobJsonKey({
      blobBase,
      key,
      bust,
      timeoutMs,
      mutableWorkflowArtifact,
      skipNextDataCache: opts.skipNextDataCache === true,
      allowForbiddenAsMissing: mode === "published",
    });
    if (value !== null) return value;
  }
  return null;
}

function fetchErrorDetail(error: unknown): string {
  if (error instanceof FetchTimeoutError) return `timeout after ${error.timeoutMs}ms`;
  return error instanceof Error ? error.message : "no response";
}

/** Read + Zod-validate a view. Returns null when the view is absent (caller → notFound()). */
export async function readView<T>(path: string, schema: ZodType<T>, opts: ViewOpts = {}): Promise<T | null> {
  const json = await rawRead(path, opts, "published");
  return json === null ? null : parseView(json, schema, { path, version: opts.bust ?? null });
}

/**
 * Read a workflow/control-plane view without turning transport failures into
 * absence or falling back from an inaccessible overlay to older sealed bytes.
 * Only a confirmed 404 returns null.
 */
export async function readAuthoritativeView<T>(
  path: string,
  schema: ZodType<T>,
  opts: ViewOpts = {},
): Promise<T | null> {
  const json = await rawRead(path, opts, "authoritative");
  return json === null ? null : parseView(json, schema, { path, version: opts.bust ?? null });
}

/** Authoritative read for a workflow artifact that must already exist. */
export async function readRequiredView<T>(
  path: string,
  schema: ZodType<T>,
  opts: ViewOpts = {},
): Promise<T> {
  const value = await readAuthoritativeView(path, schema, opts);
  if (value === null) throw new Error(`${path} missing`);
  return value;
}
