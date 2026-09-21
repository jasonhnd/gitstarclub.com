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
/** Public Blob GET is path-cached (`?v=` does not bust). Lease writes use max-age=0, same as live/latest.json (#402). */
export const LEASE_CACHE_CONTROL_MAX_AGE = 0;
export const LEASE_CAS_ATTEMPTS = 5;
export const LEASE_CAS_BACKOFF_CAP_MS = 1_500;
/** After a same-owner CAS conflict, accept a lease that was just extended instead of fighting the writer. */
export const LEASE_RENEW_COALESCE_MS = 60 * 1000;
const CLAIM_CAS_ATTEMPTS = 3;

export class WorkflowLeaseOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLeaseOwnershipError";
  }
}

/** Retryable: we still appear to own the token, but ETag CAS could not land. */
export class WorkflowLeaseCasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowLeaseCasError";
  }
}

export function normalizeLeaseEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  let value = etag.trim();
  if (!value) return null;
  if (/^w\//i.test(value)) value = value.slice(2).trim();
  return value || null;
}

export function leaseCasDelayMs(attempt: number, random = Math.random): number {
  const base = 40 * 2 ** attempt;
  return Math.min(base + Math.floor(random() * base), LEASE_CAS_BACKOFF_CAP_MS);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type LeaseCasTiming = {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

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
      etag: normalizeLeaseEtag(etag) ?? etag,
      writtenAt: this.now(),
    };
  }

  forget(): void {
    this.recent = null;
  }

  forgetIfEtag(etag: string): void {
    if (this.recent?.etag === etag || this.recent?.etag === normalizeLeaseEtag(etag)) this.recent = null;
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

  /**
   * Prefer a consistent (body, origin etag) pair.
   *
   * #475: public GET may be CDN-stale relative to Blob API `head()`. A mismatched
   * pair must not be used for ifMatch (stale body + origin etag would overwrite
   * a successor). That path withheld etag=null and retried.
   *
   * #500 / #499 week hops: each hop is a new isolate, so the 2 min write cache
   * is empty. Public GET stays stale for the Blob CDN window; 5 short CAS
   * retries still see etag=null and fail a still-owned token
   * (`could not read a consistent origin ETag while renewing`). Origin
   * `getOrigin()` is one HTTP response (body + etag) and is the fence.
   */
  async read(): Promise<WorkflowLeaseSnapshot> {
    const recent = this.writeCache.read();
    if (recent) return recent;

    const origin = await this.readOriginSnapshot();
    if (origin && (!origin.lease || origin.etag)) return origin;

    return this.readCdnSnapshot();
  }

  private async readOriginSnapshot(): Promise<WorkflowLeaseSnapshot | null> {
    const store = this.store();
    if (!store.getOrigin) return null;
    try {
      const result = await store.getOrigin(ACTIVE_PATH);
      if (!result) return { lease: null, etag: null };
      return {
        lease: WorkflowLease.parse(JSON.parse(result.body)),
        etag: normalizeLeaseEtag(result.etag),
      };
    } catch {
      return null;
    }
  }

  private async readCdnSnapshot(): Promise<WorkflowLeaseSnapshot> {
    const result = await this.store().get(ACTIVE_PATH);
    if (!result) return { lease: null, etag: null };
    const lease = WorkflowLease.parse(JSON.parse(result.body));
    const bodyEtag = normalizeLeaseEtag(result.etag);
    let originEtag: string | null = null;
    try {
      const head = await this.store().head(ACTIVE_PATH);
      originEtag = normalizeLeaseEtag(head?.etag);
    } catch {
      originEtag = null;
    }
    if (originEtag && bodyEtag && originEtag !== bodyEtag) {
      return { lease, etag: null };
    }
    return { lease, etag: originEtag ?? bodyEtag };
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    WorkflowLease.parse(lease);
    try {
      const written = await this.store().put(ACTIVE_PATH, JSON.stringify(lease), {
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: LEASE_CACHE_CONTROL_MAX_AGE,
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
        cacheControlMaxAge: LEASE_CACHE_CONTROL_MAX_AGE,
        ifMatch: etag,
      });
      this.writeCache.remember(lease, written.etag);
      return true;
    } catch (error) {
      if (isObjectStoreConflict(error)) {
        this.writeCache.forget();
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

  for (let attempt = 0; attempt < CLAIM_CAS_ATTEMPTS; attempt++) {
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

function ownsRunningLease(lease: WorkflowLease | null, runId: string, fencingToken: number): lease is WorkflowLease {
  return !!lease && lease.status === "running" && lease.run_id === runId && lease.fencing_token === fencingToken;
}

/**
 * Renew a running lease while proving both its run id and fencing generation.
 * Every protected mutation calls this immediately before writing.  A run that
 * has expired or been superseded fails closed instead of resuming stale work.
 *
 * CAS 412 while we still own the token is not ownership loss: CF queue retries
 * and a CDN-stale public GET can collide on the same generation. Those retries
 * back off, coalesce onto a peer same-owner renew, and throw a retryable
 * {@link WorkflowLeaseCasError} instead of failing the run closed. After #499
 * week hops, read prefers origin `getOrigin()` so isolate boundaries do not
 * exhaust the null-etag path.
 */
export async function renewWorkflowLease(
  runId: string,
  fencingToken: number,
  store: WorkflowLeaseStore = blobWorkflowLeaseStore,
  renewedAt = new Date().toISOString(),
  timing: LeaseCasTiming = {},
): Promise<WorkflowLease> {
  const now = Date.parse(renewedAt);
  const sleep = timing.sleep ?? defaultSleep;
  const random = timing.random ?? Math.random;

  for (let attempt = 0; attempt < LEASE_CAS_ATTEMPTS; attempt++) {
    const current = await store.read();
    const active = current.lease;
    if (!ownsRunningLease(active, runId, fencingToken)) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} no longer owns fencing token ${fencingToken}`);
    }
    if (Date.parse(active.expires_at) <= now) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} lease expired at ${active.expires_at}`);
    }
    if (!current.etag) {
      if (attempt + 1 < LEASE_CAS_ATTEMPTS) {
        await sleep(leaseCasDelayMs(attempt, random));
        continue;
      }
      throw new WorkflowLeaseCasError(
        `workflow ${runId} could not read a consistent origin ETag while renewing fencing token ${fencingToken}`,
      );
    }
    const renewed = WorkflowLease.parse({
      ...active,
      expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
    });
    if (await store.compareAndSet(current.etag, renewed)) return renewed;

    const after = await store.read();
    if (!ownsRunningLease(after.lease, runId, fencingToken)) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} no longer owns fencing token ${fencingToken}`);
    }
    if (Date.parse(after.lease.expires_at) <= now) {
      throw new WorkflowLeaseOwnershipError(`workflow ${runId} lease expired at ${after.lease.expires_at}`);
    }
    if (Date.parse(after.lease.expires_at) - now >= LEASE_TTL_MS - LEASE_RENEW_COALESCE_MS) {
      return after.lease;
    }
    if (attempt + 1 < LEASE_CAS_ATTEMPTS) await sleep(leaseCasDelayMs(attempt, random));
  }
  throw new WorkflowLeaseCasError(
    `workflow ${runId} lease CAS exhausted while renewing fencing token ${fencingToken}`,
  );
}

export async function releaseWorkflowLease(
  runId: string,
  status: "published" | "failed",
  store: WorkflowLeaseStore = blobWorkflowLeaseStore,
  releasedAt = new Date().toISOString(),
  fencingToken?: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < CLAIM_CAS_ATTEMPTS; attempt++) {
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
