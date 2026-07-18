import { BlobNotFoundError, BlobPreconditionFailedError, head, put } from "@vercel/blob";
import { WorkflowLease } from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";

const ACTIVE_PATH = "ops/workflows/active.json";
const LEASE_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 5;

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

function isBlobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(text);
}

export class BlobWorkflowLeaseStore implements WorkflowLeaseStore {
  /**
   * Read lease state via the Blob control-plane APIs (head + authorized body fetch),
   * not the public CDN edge. Public `get()` can return a body/etag pair that is up to
   * cacheControlMaxAge (floor 60s) stale — enough to break CAS right after the start
   * route writes a new lease.
   */
  async read(): Promise<WorkflowLeaseSnapshot> {
    const token = requireBlobWriteToken();
    let meta;
    try {
      meta = await head(ACTIVE_PATH, { token });
    } catch (error) {
      if (error instanceof BlobNotFoundError) return { lease: null, etag: null };
      if (error instanceof Error && /not found|404/i.test(error.message)) return { lease: null, etag: null };
      throw error;
    }

    // Bust any intermediate caches: head etag is authoritative for ifMatch CAS.
    const url = new URL(meta.url);
    url.searchParams.set("lease_bust", `${Date.now()}`);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      cache: "no-store",
    });
    if (res.status === 404) return { lease: null, etag: null };
    if (!res.ok) throw new Error(`lease read ${ACTIVE_PATH} -> ${res.status}`);
    return {
      lease: WorkflowLease.parse(JSON.parse(await res.text())),
      etag: meta.etag,
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
        // Floor is 60s on Blob; keep minimum so stale edge copies age out ASAP.
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
