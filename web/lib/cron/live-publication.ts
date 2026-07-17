import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import {
  LiveGenerationManifest,
  LiveGenerationPointer,
  LivePublicationLease,
  type LiveGenerationPointer as LiveGenerationPointerData,
  type LivePublicationLease as LivePublicationLeaseData,
} from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";
import type { LiveRefreshJob } from "./live-refresh";

const LIVE_POINTER_PATH = "live/latest.json";
const LEASE_TTL_MS = 15 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 5;

export type LiveControlSnapshot = {
  pointer: LiveGenerationPointerData | null;
  etag: string | null;
};

export interface LivePublicationStore {
  readControl(): Promise<LiveControlSnapshot>;
  createControl(pointer: LiveGenerationPointerData): Promise<boolean>;
  compareAndSetControl(etag: string, pointer: LiveGenerationPointerData): Promise<boolean>;
  putImmutable(path: string, data: unknown): Promise<void>;
  putMutable(path: string, data: unknown): Promise<void>;
}

export type LivePublicationClaim =
  | { status: "acquired"; lease: LivePublicationLeaseData; previous_generation: string | null }
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

async function putJson(path: string, data: unknown, options: { overwrite: boolean; ifMatch?: string; immutable?: boolean }): Promise<void> {
  await put(path, json(data), {
    access: "public",
    token: requireBlobWriteToken(),
    allowOverwrite: options.overwrite,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: options.immutable ? 31_536_000 : 60,
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
  });
}

export class BlobLivePublicationStore implements LivePublicationStore {
  async readControl(): Promise<LiveControlSnapshot> {
    const result = await get(LIVE_POINTER_PATH, { access: "public", token: requireBlobWriteToken() });
    if (!result) return { pointer: null, etag: null };
    if (result.statusCode !== 200 || !result.stream) {
      throw new Error(`live pointer read ${LIVE_POINTER_PATH} -> ${result.statusCode}`);
    }
    return {
      pointer: LiveGenerationPointer.parse(JSON.parse(await streamText(result.stream))),
      etag: result.blob.etag,
    };
  }

  async createControl(pointer: LiveGenerationPointerData): Promise<boolean> {
    LiveGenerationPointer.parse(pointer);
    try {
      await putJson(LIVE_POINTER_PATH, pointer, { overwrite: false });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }

  async compareAndSetControl(etag: string, pointer: LiveGenerationPointerData): Promise<boolean> {
    LiveGenerationPointer.parse(pointer);
    try {
      await putJson(LIVE_POINTER_PATH, pointer, { overwrite: true, ifMatch: etag });
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
    if (won) return { status: "acquired", lease, previous_generation: pointer?.generation ?? null };
  }

  throw new Error("failed to acquire live publication lease after concurrent updates");
}

/** Release only this run's still-current lease. A fenced writer cannot clear a
 * successor's lease. */
export async function releaseLivePublication(
  runId: string,
  store: LivePublicationStore = blobLivePublicationStore,
): Promise<boolean> {
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

  const control = await store.readControl();
  const pointer = control.pointer;
  if (!pointer || pointer.lease?.run_id !== args.runId || pointer.lease.idempotency_key !== args.idempotencyKey) {
    throw new Error("live publication lease was fenced before commit");
  }
  if (!leaseIsActive(pointer.lease, args.now ?? Date.now())) throw new Error("live publication lease expired before commit");

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
    previous_generation: pointer.generation,
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

  // Re-read after the manifest write so takeover/expiry during a slow upload is
  // fenced by the latest pointer ETag, not the pre-upload snapshot.
  const commitControl = await store.readControl();
  if (
    !commitControl.pointer ||
    commitControl.pointer.lease?.run_id !== args.runId ||
    commitControl.pointer.lease.idempotency_key !== args.idempotencyKey
  ) {
    throw new Error("live publication lease was fenced before pointer commit");
  }
  const commitNow = args.now ?? Date.now();
  if (!leaseIsActive(commitControl.pointer.lease, commitNow)) throw new Error("live publication lease expired before pointer commit");
  if (!commitControl.etag) throw new Error("live publication pointer is missing an ETag");

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
    previous_generation: commitControl.pointer.generation,
    lease: null,
  });
  if (!(await store.compareAndSetControl(commitControl.etag, next))) {
    throw new Error("live publication pointer commit lost its fencing CAS");
  }

  return { generation, manifest: manifestPath, previous_generation: next.previous_generation, published_at: publishedAt };
}
