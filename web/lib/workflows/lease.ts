import { WorkflowLease } from "@/lib/contracts";
import { getWriteObjectStore, isObjectStoreConflict, type ObjectStore } from "@/lib/storage";

const ACTIVE_PATH = "ops/workflows/active.json";
export const LEASE_TTL_MS = 30 * 60 * 1000;
export const LEASE_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
// Blob overwrites may continue serving the previous bytes from the public CDN
// during its short cache window. Keep the exact ETag returned by our own
// successful write long enough for same-process renew/release calls to observe
// their write immediately. Every subsequent mutation still uses ifMatch, so a
// competing writer invalidates the cached snapshot instead of being overwritten.
export const LEASE_READ_YOUR_WRITES_MS = 2 * 60 * 1000;
const MAX_CAS_ATTEMPTS = 3;

export class WorkflowLeaseOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLeaseOwnershipError";
  }
}

export type WorkflowLeaseSnapshot = {
  lease: WorkflowLease | null;
  etag: string | null;
};

export type WorkflowLeaseStore = {
  read(): Promise<WorkflowLeaseSnapshot>;
  create(lease: WorkflowLease): Promise<boolean>;
  compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean>;
};

type RecentWorkflowLeaseWrite = WorkflowLeaseSnapshot & {
  writtenAt: number;
};

export class WorkflowLeaseWriteCache {
  private recent: RecentWorkflowLeaseWrite | null = null;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = LEASE_READ_YOUR_WRITES_MS,
  ) {}

  read(): WorkflowLeaseSnapshot | null {
    if (!this.recent) return null;
    if (this.now() - this.recent.writtenAt >= this.ttlMs) {
      this.recent = null;
      return null;
    }
    return {
      lease: this.recent.lease ? structuredClone(this.recent.lease) : null,
      etag: this.recent.etag,
    };
  }

  remember(lease: WorkflowLease, etag: string): void {
    this.recent = {
      lease: structuredClone(lease),
      etag,
      writtenAt: this.now(),
    };
  }

  forgetIfEtag(etag: string): void {
    if (this.recent?.etag === etag) this.recent = null;
  }
}

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

export type WorkflowOwnership = {
  runId: string;
  fencingToken: number;
};

export class BlobWorkflowLeaseStore implements WorkflowLeaseStore {
  constructor(
    private readonly writeCache = new WorkflowLeaseWriteCache(),
    private readonly objects?: ObjectStore,
  ) {}

  private store(): ObjectStore {
    return this.objects ?? getWriteObjectStore();
  }

  async read(): Promise<WorkflowLeaseSnapshot> {
    const recent = this.writeCache.read();
    if (recent) return recent;

    const result = await this.store().get(ACTIVE_PATH);
    if (!result) return { lease: null, etag: null };
    return {
      lease: WorkflowLease.parse(JSON.parse(result.body)),
      etag: result.etag,
    };
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    WorkflowLease.parse(lease);
    try {
      const written = await this.store().put(ACTIVE_PATH, JSON.stringify(lease), {
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      this.writeCache.remember(lease, written.etag);
      return true;
    } catch (error) {
      if (isObjectStoreConflict(error)) return false;
      throw error;
    }
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    WorkflowLease.parse(lease);
    try {
      const written = await this.store().put(ACTIVE_PATH, JSON.stringify(lease), {
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ifMatch: etag,
      });
      this.writeCache.remember(lease, written.etag);
      return true;
    } catch (error) {
      if (isObjectStoreConflict(error)) {
        this.writeCache.forgetIfEtag(etag);
        return false;
      }
      throw error;
    }
  }
}

export const blobWorkflowLeaseStore = new BlobWorkflowLeaseStore();

export function workflowLease(args: ClaimArgs, fencingToken = 1): WorkflowLease {
  const now = args.now ?? Date.parse(args.acquiredAt);
  const lease = {
    run_id: args.runId,
    status: "running",
    acquired_at: args.acquiredAt,
    expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
    fencing_token: fencingToken,
    idempotency_key: args.idempotencyKey,
    trigger: args.trigger,
  };
  return WorkflowLease.parse(lease);
}

export async function claimWorkflowLease(args: ClaimArgs, store: WorkflowLeaseStore = blobWorkflowLeaseStore): Promise<WorkflowLeaseClaim> {
  const now = args.now ?? Date.parse(args.acquiredAt);

  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    const active = current.lease;
    if (!active) {
      const next = workflowLease({ ...args, now }, 1);
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
    const next = workflowLease({ ...args, now }, active.fencing_token + 1);
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

/**
 * Renew a running lease while proving both its run id and fencing generation.
 * Every protected mutation calls this immediately before writing.  A run that
 * has expired or been superseded fails closed instead of resuming stale work.
 */
export async function renewWorkflowLease(
  runId: string,
  fencingToken: number,
  store: WorkflowLeaseStore = blobWorkflowLeaseStore,
  renewedAt = new Date().toISOString(),
): Promise<WorkflowLease> {
  const now = Date.parse(renewedAt);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    const active = current.lease;
    if (!active || active.status !== "running" || active.run_id !== runId || active.fencing_token !== fencingToken) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} no longer owns fencing token ${fencingToken}`);
    }
    if (Date.parse(active.expires_at) <= now) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} lease expired at ${active.expires_at}`);
    }
    if (!current.etag) throw new Error("active workflow lease is missing an ETag");
    const renewed = WorkflowLease.parse({
      ...active,
      expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
    });
    if (await store.compareAndSet(current.etag, renewed)) return renewed;
  }
  throw new WorkflowLeaseOwnershipError(`workflow ${runId} lost ownership while renewing fencing token ${fencingToken}`);
}

export async function releaseWorkflowLease(
  runId: string,
  status: "published" | "failed",
  store: WorkflowLeaseStore = blobWorkflowLeaseStore,
  releasedAt = new Date().toISOString(),
  fencingToken?: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    if (
      !current.lease ||
      current.lease.run_id !== runId ||
      (fencingToken !== undefined && current.lease.fencing_token !== fencingToken)
    ) return false;
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
