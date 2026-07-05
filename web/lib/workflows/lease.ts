import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import { WorkflowLease } from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";

const ACTIVE_PATH = "ops/workflows/active.json";
const LEASE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 3;

export type WorkflowLeaseSnapshot = {
  lease: WorkflowLease | null;
  etag: string | null;
};

export type WorkflowLeaseStore = {
  read(): Promise<WorkflowLeaseSnapshot>;
  create(lease: WorkflowLease): Promise<boolean>;
  compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean>;
};

export type WorkflowLeaseClaim =
  | { status: "acquired"; lease: WorkflowLease }
  | { status: "attached"; lease: WorkflowLease }
  | { status: "rejected"; lease: WorkflowLease };

type ClaimArgs = {
  runId: string;
  acquiredAt: string;
  idempotencyKey: string;
  trigger: string;
  now?: number;
  allowExistingRun?: boolean;
};

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function isBlobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(text);
}

export class BlobWorkflowLeaseStore implements WorkflowLeaseStore {
  async read(): Promise<WorkflowLeaseSnapshot> {
    const result = await get(ACTIVE_PATH, { access: "public", token: requireBlobWriteToken() });
    if (!result) return { lease: null, etag: null };
    if (result.statusCode !== 200 || !result.stream) throw new Error(`lease read ${ACTIVE_PATH} -> ${result.statusCode}`);
    return {
      lease: WorkflowLease.parse(JSON.parse(await streamText(result.stream))),
      etag: result.blob.etag,
    };
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    WorkflowLease.parse(lease);
    try {
      await put(ACTIVE_PATH, JSON.stringify(lease), {
        access: "public",
        token: requireBlobWriteToken(),
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    WorkflowLease.parse(lease);
    try {
      await put(ACTIVE_PATH, JSON.stringify(lease), {
        access: "public",
        token: requireBlobWriteToken(),
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ifMatch: etag,
      });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }
}

export const blobWorkflowLeaseStore = new BlobWorkflowLeaseStore();

export function workflowLease(args: ClaimArgs): WorkflowLease {
  const now = args.now ?? Date.parse(args.acquiredAt);
  const lease = {
    run_id: args.runId,
    status: "running",
    acquired_at: args.acquiredAt,
    expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
    idempotency_key: args.idempotencyKey,
    trigger: args.trigger,
  };
  return WorkflowLease.parse(lease);
}

export async function claimWorkflowLease(args: ClaimArgs, store: WorkflowLeaseStore = blobWorkflowLeaseStore): Promise<WorkflowLeaseClaim> {
  const now = args.now ?? Date.parse(args.acquiredAt);
  const next = workflowLease({ ...args, now });

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    const active = current.lease;
    if (!active) {
      if (await store.create(next)) return { status: "acquired", lease: next };
      continue;
    }

    const running = active.status === "running" && Date.parse(active.expires_at) > now;
    if (running && active.run_id === args.runId) {
      return args.allowExistingRun ? { status: "acquired", lease: active } : { status: "attached", lease: active };
    }
    if (running && active.idempotency_key === args.idempotencyKey) return { status: "attached", lease: active };
    if (running) return { status: "rejected", lease: active };

    if (!current.etag) throw new Error("active workflow lease is missing an ETag");
    if (await store.compareAndSet(current.etag, next)) return { status: "acquired", lease: next };
  }

  const current = await store.read();
  if (current.lease?.status === "running" && Date.parse(current.lease.expires_at) > now) {
    return current.lease.idempotency_key === args.idempotencyKey
      ? { status: "attached", lease: current.lease }
      : { status: "rejected", lease: current.lease };
  }
  throw new Error("failed to acquire workflow lease after concurrent updates");
}

export async function releaseWorkflowLease(
  runId: string,
  status: "published" | "failed",
  store: WorkflowLeaseStore = blobWorkflowLeaseStore,
  releasedAt = new Date().toISOString(),
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    if (!current.lease || current.lease.run_id !== runId) return false;
    if (!current.etag) throw new Error("active workflow lease is missing an ETag");
    const lease = WorkflowLease.parse({
      ...current.lease,
      status,
      acquired_at: releasedAt,
      expires_at: releasedAt,
    });
    if (await store.compareAndSet(current.etag, lease)) return true;
  }
  return false;
}
