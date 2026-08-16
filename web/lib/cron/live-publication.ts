import { BlobNotFoundError, BlobPreconditionFailedError, get, head, put } from "@vercel/blob";
import {
  LiveGenerationManifest,
  LiveGenerationPointer,
  LivePublicationLease,
  type LiveGenerationPointer as LiveGenerationPointerData,
  type LivePublicationLease as LivePublicationLeaseData,
} from "@/lib/contracts";
import { BLOB_JSON_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import { requireBlobBaseUrl, requireBlobWriteToken } from "@/lib/runtime-config";
import type { LiveRefreshJob } from "./live-refresh";

const LIVE_POINTER_PATH = "live/latest.json";
const LEASE_TTL_MS = 15 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 5;

/** Pointer writes use max-age=0. Public GET cannot fence: this store is public
 * (`useCache: false` is private-only) and the CDN is path-keyed (`?v=` does not
 * bust). Publish/release use Blob API `head()` etag from lease acquire. Page
 * readers still memoize generation for 60s in `source.ts`. */
export const LIVE_POINTER_CACHE_CONTROL_MAX_AGE = 0;

export function livePointerReadUrl(blobBase: string, now = Date.now()): string {
  return `${blobBase.replace(/\/+$/, "")}/${LIVE_POINTER_PATH}?v=${now}`;
}

export type LiveControlSnapshot = {
  pointer: LiveGenerationPointerData | null;
  etag: string | null;
};

export interface LivePublicationStore {
  readControl(): Promise<LiveControlSnapshot>;
  /** Origin metadata etag. Public GET of this store is CDN-cached and cannot fence. */
  headEtag(): Promise<string | null>;
  createControl(pointer: LiveGenerationPointerData): Promise<boolean>;
  compareAndSetControl(etag: string, pointer: LiveGenerationPointerData): Promise<boolean>;
  putImmutable(path: string, data: unknown): Promise<void>;
  putMutable(path: string, data: unknown): Promise<void>;
}

export type LivePublicationClaim =
  | { status: "acquired"; lease: LivePublicationLeaseData; previous_generation: string | null; etag: string }
  | { status: "attached"; lease: LivePublicationLeaseData; generation: string | null }
  | { status: "rejected"; lease: LivePublicationLeaseData; generation: string | null }
  | { status: "committed"; pointer: LiveGenerationPointerData };

export type LivePublicationArtifact = { path: string; data: unknown };

export type PublishLiveGenerationArgs = {
  runId: string;
  idempotencyKey: string;
  job: LiveRefreshJob;
  day: string;
  month: string;
  week: string;
  createdAt: string;
  artifacts: LivePublicationArtifact[];
  /** Mutable compatibility/canonical writes that must exist before publication.
   * They are outside the reader generation, so a partial write cannot expose a
   * mixed live view. */
  prerequisites?: LivePublicationArtifact[];
  now?: number;
  /** Origin etag from immediately after this process acquired the lease. */
  claimedEtag?: string;
  claimedPreviousGeneration?: string | null;
};

function json(data: unknown): string {
  return JSON.stringify(data);
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function isBlobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(`${error.name} ${error.message}`);
}

async function readBlobText(path: string): Promise<string | null> {
  const result = await get(path, { access: "public", token: requireBlobWriteToken() });
  if (!result) return null;
  if (result.statusCode !== 200 || !result.stream) throw new Error(`blob read ${path} -> ${result.statusCode}`);
  return streamText(result.stream);
}

async function putJson(
  path: string,
  data: unknown,
  options: { overwrite: boolean; ifMatch?: string; immutable?: boolean; cacheControlMaxAge?: number },
): Promise<void> {
  await put(path, json(data), {
    access: "public",
    token: requireBlobWriteToken(),
    allowOverwrite: options.overwrite,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: options.cacheControlMaxAge ?? (options.immutable ? 31_536_000 : 60),
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  });
}

export class BlobLivePublicationStore implements LivePublicationStore {
  async readControl(): Promise<LiveControlSnapshot> {
    const res = await fetchWithTimeout(livePointerReadUrl(requireBlobBaseUrl()), {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      timeoutMs: BLOB_JSON_FETCH_TIMEOUT_MS,
    });
    if (res.status === 404) return { pointer: null, etag: null };
    if (!res.ok) throw new Error(`live pointer read ${LIVE_POINTER_PATH} -> ${res.status}`);
    return {
      pointer: LiveGenerationPointer.parse(await res.json()),
      etag: res.headers.get("etag"),
    };
  }

  async createControl(pointer: LiveGenerationPointerData): Promise<boolean> {
    LiveGenerationPointer.parse(pointer);
    try {
      await putJson(LIVE_POINTER_PATH, pointer, { overwrite: false, cacheControlMaxAge: LIVE_POINTER_CACHE_CONTROL_MAX_AGE });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }

  async compareAndSetControl(etag: string, pointer: LiveGenerationPointerData): Promise<boolean> {
    LiveGenerationPointer.parse(pointer);
    try {
      await putJson(LIVE_POINTER_PATH, pointer, {
        overwrite: true,
        ifMatch: etag,
        cacheControlMaxAge: LIVE_POINTER_CACHE_CONTROL_MAX_AGE,
      });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }

  async putImmutable(path: string, data: unknown): Promise<void> {
    const payload = json(data);
    try {
      await putJson(path, data, { overwrite: false, immutable: true });
    } catch (error) {
      if (!isBlobConflict(error)) throw error;
      const existing = await readBlobText(path);
      if (existing !== payload) throw new Error(`immutable live object conflict: ${path}`);
    }
  }

  async putMutable(path: string, data: unknown): Promise<void> {
    await putJson(path, data, { overwrite: true });
  }

  async headEtag(): Promise<string | null> {
    try {
      const result = await head(LIVE_POINTER_PATH, { token: requireBlobWriteToken() });
      return result.etag || null;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return null;
      throw error;
    }
  }
}

export const blobLivePublicationStore = new BlobLivePublicationStore();

function unpublishedPointer(lease: LivePublicationLeaseData): LiveGenerationPointerData {
  return LiveGenerationPointer.parse({
    schema_ver: 1,
    generation: null,
    run_id: null,
    idempotency_key: null,
    job: null,
    day: null,
    month: null,
    week: null,
    published_at: null,
    previous_generation: null,
    lease,
  });
}

function leaseFor(args: {
  runId: string;
  idempotencyKey: string;
  job: LiveRefreshJob;
  acquiredAt: string;
  now?: number;
}): LivePublicationLeaseData {
  const now = args.now ?? Date.parse(args.acquiredAt);
  return LivePublicationLease.parse({
    run_id: args.runId,
    idempotency_key: args.idempotencyKey,
    job: args.job,
    acquired_at: args.acquiredAt,
    expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
  });
}

function leaseIsActive(lease: LivePublicationLeaseData | null, now: number): lease is LivePublicationLeaseData {
  return !!lease && Date.parse(lease.expires_at) > now;
}

export async function claimLivePublication(
  args: {
    runId: string;
    idempotencyKey: string;
    job: LiveRefreshJob;
    acquiredAt: string;
    now?: number;
  },
  store: LivePublicationStore = blobLivePublicationStore,
): Promise<LivePublicationClaim> {
  const now = args.now ?? Date.parse(args.acquiredAt);
  const lease = leaseFor({ ...args, now });

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.readControl();
    const pointer = current.pointer;
    if (pointer?.generation && pointer.idempotency_key === args.idempotencyKey) {
      return { status: "committed", pointer };
    }
    if (pointer && leaseIsActive(pointer.lease, now)) {
      return pointer.lease.idempotency_key === args.idempotencyKey
        ? { status: "attached", lease: pointer.lease, generation: pointer.generation }
        : { status: "rejected", lease: pointer.lease, generation: pointer.generation };
    }

    const next = pointer ? LiveGenerationPointer.parse({ ...pointer, lease }) : unpublishedPointer(lease);
    const won = pointer
      ? !!current.etag && await store.compareAndSetControl(current.etag, next)
      : await store.createControl(next);
    if (won) {
      const etag = await store.headEtag();
      if (!etag) throw new Error("live publication pointer is missing an ETag after lease acquire");
      return { status: "acquired", lease, previous_generation: pointer?.generation ?? null, etag };
    }
  }

  throw new Error("failed to acquire live publication lease after concurrent updates");
}

export type ReleaseLivePublicationOptions = {
  /** Origin etag from immediately after this process acquired the lease. */
  claimedEtag?: string;
};

/** Release only this run's still-current lease. A fenced writer cannot clear a
 * successor's lease. Prefer `claimedEtag` so a CDN-stale public body cannot
 * skip the clear and leave the lease stuck until expiry. */
export async function releaseLivePublication(
  runId: string,
  store: LivePublicationStore = blobLivePublicationStore,
  options: ReleaseLivePublicationOptions = {},
): Promise<boolean> {
  if (options.claimedEtag) {
    const originEtag = await store.headEtag();
    if (!originEtag || normalizeEtag(originEtag) !== normalizeEtag(options.claimedEtag)) return false;
    const current = await store.readControl();
    if (!current.pointer) return false;
    const next = LiveGenerationPointer.parse({ ...current.pointer, lease: null });
    return store.compareAndSetControl(originEtag, next);
  }

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.readControl();
    if (!current.pointer || current.pointer.lease?.run_id !== runId) return false;
    if (!current.etag) throw new Error("live publication pointer is missing an ETag");
    const next = LiveGenerationPointer.parse({ ...current.pointer, lease: null });
    if (await store.compareAndSetControl(current.etag, next)) return true;
  }
  return false;
}

/** Write a complete immutable generation, then atomically flip the single
 * pointer with the lease-bearing pointer ETag as the fence. */
export async function publishLiveGeneration(
  args: PublishLiveGenerationArgs,
  store: LivePublicationStore = blobLivePublicationStore,
): Promise<{ generation: string; manifest: string; previous_generation: string | null; published_at: string }> {
  const generation = args.runId;
  const root = `live/generations/${generation}`;
  const paths = args.artifacts.map((artifact) => artifact.path);
  if (new Set(paths).size !== paths.length) throw new Error("live generation contains duplicate artifact paths");

  const previousGeneration = await assertHeldLease(store, args);

  const manifestPath = `${root}/manifest.json`;
  const manifest = LiveGenerationManifest.parse({
    schema_ver: 1,
    generation,
    run_id: args.runId,
    idempotency_key: args.idempotencyKey,
    job: args.job,
    day: args.day,
    month: args.month,
    week: args.week,
    created_at: args.createdAt,
    previous_generation: previousGeneration,
    files: paths,
  });

  for (const prerequisite of args.prerequisites ?? []) {
    if (prerequisite.path.startsWith("/") || prerequisite.path.split("/").includes("..") || !prerequisite.path.endsWith(".json")) {
      throw new Error(`unsafe live publication prerequisite path: ${prerequisite.path}`);
    }
  }
  for (const prerequisite of args.prerequisites ?? []) {
    await store.putMutable(prerequisite.path, prerequisite.data);
  }
  for (const artifact of args.artifacts) {
    await store.putImmutable(`${root}/${artifact.path}`, artifact.data);
  }
  await store.putImmutable(manifestPath, manifest);

  // Fence with the origin etag, not a public GET of the pointer body. The public
  // object is CDN-cached; a same-process weekly reuse would otherwise re-read
  // the pre-lease body and false-fence.
  const commitEtag = await requireUnchangedOriginEtag(store, args, "live publication lease was fenced before pointer commit");
  const commitNow = args.now ?? Date.now();

  const publishedAt = new Date(commitNow).toISOString();
  const next = LiveGenerationPointer.parse({
    schema_ver: 1,
    generation,
    run_id: args.runId,
    idempotency_key: args.idempotencyKey,
    job: args.job,
    day: args.day,
    month: args.month,
    week: args.week,
    published_at: publishedAt,
    previous_generation: previousGeneration,
    lease: null,
  });
  if (!(await store.compareAndSetControl(commitEtag, next))) {
    throw new Error("live publication pointer commit lost its fencing CAS");
  }

  return { generation, manifest: manifestPath, previous_generation: next.previous_generation, published_at: publishedAt };
}

async function assertHeldLease(store: LivePublicationStore, args: PublishLiveGenerationArgs): Promise<string | null> {
  if (args.claimedEtag) {
    await requireUnchangedOriginEtag(store, args, "live publication lease was fenced before commit");
    return args.claimedPreviousGeneration ?? null;
  }

  const control = await store.readControl();
  const pointer = control.pointer;
  if (!pointer || pointer.lease?.run_id !== args.runId || pointer.lease.idempotency_key !== args.idempotencyKey) {
    throw new Error("live publication lease was fenced before commit");
  }
  if (!leaseIsActive(pointer.lease, args.now ?? Date.now())) throw new Error("live publication lease expired before commit");
  return pointer.generation;
}

async function requireUnchangedOriginEtag(
  store: LivePublicationStore,
  args: PublishLiveGenerationArgs,
  message: string,
): Promise<string> {
  const originEtag = await store.headEtag();
  if (!originEtag) throw new Error("live publication pointer is missing an ETag");
  if (args.claimedEtag && normalizeEtag(originEtag) !== normalizeEtag(args.claimedEtag)) {
    throw new Error(message);
  }
  if (!args.claimedEtag) {
    const control = await store.readControl();
    if (
      !control.pointer ||
      control.pointer.lease?.run_id !== args.runId ||
      control.pointer.lease.idempotency_key !== args.idempotencyKey
    ) {
      throw new Error(message);
    }
    if (!leaseIsActive(control.pointer.lease, args.now ?? Date.now())) {
      throw new Error("live publication lease expired before pointer commit");
    }
    if (!control.etag) throw new Error("live publication pointer is missing an ETag");
    return control.etag;
  }
  return originEtag;
}

function normalizeEtag(etag: string): string {
  return etag.replaceAll(/^"+|"+$/g, "");
}
