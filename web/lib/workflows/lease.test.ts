import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import type { ObjectStore } from "@/lib/storage";
import {
  BlobWorkflowLeaseStore,
  LEASE_CACHE_CONTROL_MAX_AGE,
  LEASE_CAS_ATTEMPTS,
  LEASE_READ_YOUR_WRITES_MS,
  LEASE_RENEW_COALESCE_MS,
  LEASE_TTL_MS,
  WorkflowLeaseCasError,
  WorkflowLeaseWriteCache,
  claimWorkflowLease,
  leaseCasDelayMs,
  normalizeLeaseEtag,
  releaseWorkflowLease,
  renewWorkflowLease,
  type WorkflowLeaseSnapshot,
  type WorkflowLeaseStore,
} from "./lease";

describe("workflow lease read-your-writes cache", () => {
  test("returns the exact recent lease and ETag until the Blob cache window has passed", () => {
    let now = 1_000;
    const cache = new WorkflowLeaseWriteCache(() => now);
    const lease = runningLease(
      "refresh-new",
      "2026-07-05T06:00:00.000Z",
      "2026-07-05T06:30:00.000Z",
      "manual-new",
      2,
    );

    cache.remember(lease, '"new"');
    expect(cache.read()).toEqual({ lease, etag: '"new"' });

    now += LEASE_READ_YOUR_WRITES_MS;
    expect(cache.read()).toBeNull();
  });

  test("the Blob store reads its successful write before consulting the stale CDN", async () => {
    const cache = new WorkflowLeaseWriteCache();
    const lease = runningLease(
      "refresh-new",
      "2026-07-05T06:00:00.000Z",
      "2026-07-05T06:30:00.000Z",
      "manual-new",
      2,
    );
    cache.remember(lease, '"new"');

    const store = new BlobWorkflowLeaseStore(cache);
    expect(await store.read()).toEqual({ lease, etag: '"new"' });
  });

  test("only clears the cached generation whose conditional write conflicted", () => {
    const cache = new WorkflowLeaseWriteCache();
    const lease = runningLease(
      "refresh-new",
      "2026-07-05T06:00:00.000Z",
      "2026-07-05T06:30:00.000Z",
      "manual-new",
      2,
    );

    cache.remember(lease, '"new"');
    cache.forgetIfEtag('"old"');
    expect(cache.read()?.etag).toBe('"new"');

    cache.forgetIfEtag('"new"');
    expect(cache.read()).toBeNull();
  });

  test("forget() clears any cached generation", () => {
    const cache = new WorkflowLeaseWriteCache();
    cache.remember(
      runningLease("refresh-new", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-new", 2),
      '"new"',
    );
    cache.forget();
    expect(cache.read()).toBeNull();
  });
});

describe("lease ETag normalize", () => {
  test("strips a weak validator so CDN GET and origin head can match", () => {
    expect(normalizeLeaseEtag('W/"abc"')).toBe('"abc"');
    expect(normalizeLeaseEtag('w/"abc"')).toBe('"abc"');
    expect(normalizeLeaseEtag('"abc"')).toBe('"abc"');
    expect(normalizeLeaseEtag("  ")).toBeNull();
    expect(normalizeLeaseEtag(undefined)).toBeNull();
  });

  test("CAS backoff grows then caps", () => {
    expect(leaseCasDelayMs(0, () => 0)).toBe(40);
    expect(leaseCasDelayMs(1, () => 0)).toBe(80);
    expect(leaseCasDelayMs(10, () => 0)).toBe(1_500);
  });
});

class MemoryLeaseStore implements WorkflowLeaseStore {
  lease: WorkflowLease | null;
  etag: string | null;
  private version = 0;
  private blockedReads = 0;
  private releaseReads: (() => void) | null = null;
  private readonly readGate: Promise<void> | null;

  constructor(initial: WorkflowLease | null = null, barrierReads = 0) {
    this.lease = initial ? structuredClone(initial) : null;
    this.etag = initial ? `"${++this.version}"` : null;
    this.readGate =
      barrierReads > 0
        ? new Promise((resolve) => {
            this.releaseReads = resolve;
          })
        : null;
  }

  async read(): Promise<WorkflowLeaseSnapshot> {
    const snapshot = {
      lease: this.lease ? structuredClone(this.lease) : null,
      etag: this.etag,
    };
    if (this.readGate && this.blockedReads < 2) {
      this.blockedReads += 1;
      if (this.blockedReads === 2) this.releaseReads?.();
      await this.readGate;
    }
    return snapshot;
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    if (this.lease) return false;
    this.lease = structuredClone(lease);
    this.etag = `"${++this.version}"`;
    return true;
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    if (this.etag !== etag) return false;
    this.lease = structuredClone(lease);
    this.etag = `"${++this.version}"`;
    return true;
  }
}

function runningLease(
  runId: string,
  acquiredAt: string,
  expiresAt: string,
  idempotencyKey: string,
  fencingToken = 1,
): WorkflowLease {
  return WorkflowLease.parse({
    run_id: runId,
    status: "running",
    acquired_at: acquiredAt,
    expires_at: expiresAt,
    fencing_token: fencingToken,
    idempotency_key: idempotencyKey,
    trigger: "test",
  });
}

describe("workflow lease acquisition", () => {
  test("only one concurrent claimant can acquire an empty lease", async () => {
    const store = new MemoryLeaseStore(null, 2);
    const now = Date.parse("2026-07-05T06:00:00.000Z");

    const results = await Promise.all([
      claimWorkflowLease(
        {
          runId: "refresh-a",
          acquiredAt: "2026-07-05T06:00:00.000Z",
          idempotencyKey: "manual-a",
          trigger: "test",
          now,
        },
        store,
      ),
      claimWorkflowLease(
        {
          runId: "refresh-b",
          acquiredAt: "2026-07-05T06:00:00.000Z",
          idempotencyKey: "manual-b",
          trigger: "test",
          now,
        },
        store,
      ),
    ]);

    expect(results.filter((result) => result.status === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.lease?.status).toBe("running");
  });

  test("a new run can atomically take over an expired lease", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-old", "2026-07-04T06:00:00.000Z", "2026-07-04T18:00:00.000Z", "workflow-refresh:2026-W27"),
    );

    const result = await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W28",
        trigger: "test",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    expect(result.status).toBe("acquired");
    expect(result.lease.run_id).toBe("refresh-new");
    expect(result.lease.fencing_token).toBe(2);
    expect(store.lease?.run_id).toBe("refresh-new");
  });

  test("same-period retry attaches to the existing active run", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-existing", "2026-07-05T06:00:00.000Z", "2026-07-05T18:00:00.000Z", "workflow-refresh:2026-W27"),
    );

    const result = await claimWorkflowLease(
      {
        runId: "refresh-retry",
        acquiredAt: "2026-07-05T06:01:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W27",
        trigger: "test",
        now: Date.parse("2026-07-05T06:01:00.000Z"),
      },
      store,
    );

    expect(result.status).toBe("attached");
    expect(result.lease.run_id).toBe("refresh-existing");
  });

  test("heartbeat extends the lease without changing its fencing generation", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:20:00.000Z", "manual-a", 9),
    );

    const renewedAt = "2026-07-05T06:10:00.000Z";
    const renewed = await renewWorkflowLease("refresh-a", 9, store, renewedAt);

    expect(renewed.fencing_token).toBe(9);
    expect(renewed.expires_at).toBe(new Date(Date.parse(renewedAt) + LEASE_TTL_MS).toISOString());
    expect(store.lease).toEqual(renewed);
  });

  test("an expired/taken-over run cannot renew, mutate, or release the new generation", async () => {
    const old = runningLease("refresh-old", "2026-07-05T05:00:00.000Z", "2026-07-05T05:30:00.000Z", "manual-old", 4);
    const store = new MemoryLeaseStore(old);
    const takeover = await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "manual-new",
        trigger: "test",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    expect(takeover.lease.fencing_token).toBe(5);
    await expect(renewWorkflowLease("refresh-old", 4, store, "2026-07-05T06:01:00.000Z")).rejects.toThrow(
      "no longer owns fencing token 4",
    );
    expect(await releaseWorkflowLease("refresh-old", "failed", store, "2026-07-05T06:01:00.000Z", 4)).toBe(false);
    expect(store.lease?.run_id).toBe("refresh-new");
    expect(store.lease?.fencing_token).toBe(5);
  });

  test("a heartbeat after the lease deadline fails closed", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:20:00.000Z", "manual-a", 3),
    );

    await expect(renewWorkflowLease("refresh-a", 3, store, "2026-07-05T06:20:00.000Z")).rejects.toThrow("lease expired");
    expect(store.lease?.expires_at).toBe("2026-07-05T06:20:00.000Z");
  });

  test("delayed start of an old run cannot attach after a successor lease is acquired", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-old", "2026-07-05T05:00:00.000Z", "2026-07-05T05:30:00.000Z", "run:refresh-old", 2),
    );
    await claimWorkflowLease(
      {
        runId: "refresh-new",
        acquiredAt: "2026-07-05T06:00:00.000Z",
        idempotencyKey: "workflow-refresh:2026-W28",
        trigger: "cron",
        now: Date.parse("2026-07-05T06:00:00.000Z"),
      },
      store,
    );

    const late = await claimWorkflowLease(
      {
        runId: "refresh-old",
        acquiredAt: "2026-07-05T06:00:30.000Z",
        idempotencyKey: "run:refresh-old",
        trigger: "workflow",
        allowExistingRun: true,
        now: Date.parse("2026-07-05T06:00:30.000Z"),
      },
      store,
    );
    expect(late.status).toBe("rejected");
    expect(late.lease.run_id).toBe("refresh-new");
  });

  test("late failed release of an old run does not overwrite the successor lease", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-new", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "workflow-refresh:2026-W28", 7),
    );
    expect(await releaseWorkflowLease("refresh-old", "failed", store, "2026-07-05T06:05:00.000Z", 6)).toBe(false);
    expect(store.lease?.run_id).toBe("refresh-new");
    expect(store.lease?.status).toBe("running");
    expect(store.lease?.fencing_token).toBe(7);
  });

  test("two overlapping claims with different keys only one acquires", async () => {
    const store = new MemoryLeaseStore(null, 2);
    const now = Date.parse("2026-07-05T06:00:00.000Z");
    const [a, b] = await Promise.all([
      claimWorkflowLease(
        { runId: "refresh-a", acquiredAt: "2026-07-05T06:00:00.000Z", idempotencyKey: "k-a", trigger: "t", now },
        store,
      ),
      claimWorkflowLease(
        { runId: "refresh-b", acquiredAt: "2026-07-05T06:00:00.000Z", idempotencyKey: "k-b", trigger: "t", now },
        store,
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual(["acquired", "rejected"]);
    expect(store.lease?.status).toBe("running");
  });
});

describe("workflow lease renew under CF-style contention", () => {
  const timing = { sleep: async () => {}, random: () => 0 };

  test("overlapping same-owner renews both succeed on one generation", async () => {
    const store = new MemoryLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:20:00.000Z", "manual-a", 21),
    );

    const [first, second] = await Promise.all([
      renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:10:00.000Z", timing),
      renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:10:00.000Z", timing),
    ]);

    expect(first.fencing_token).toBe(21);
    expect(second.fencing_token).toBe(21);
    expect(store.lease?.run_id).toBe("refresh-a");
    expect(store.lease?.status).toBe("running");
  });

  test("a stale ETag then a fresh origin ETag renews instead of failing closed", async () => {
    const lease = runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 21);
    const store = new StaleThenFreshLeaseStore(lease);
    const sleeps: number[] = [];

    const renewed = await renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:04:00.000Z", {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
    });

    expect(renewed.fencing_token).toBe(21);
    expect(store.writes).toBe(1);
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
  });

  test("a peer same-owner renew is coalesced after CAS conflict", async () => {
    const store = new PeerRenewLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 21),
      "2026-07-05T06:40:00.000Z",
    );

    const renewed = await renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:10:00.000Z", timing);

    expect(renewed.expires_at).toBe("2026-07-05T06:40:00.000Z");
    expect(renewed.fencing_token).toBe(21);
    expect(store.writes).toBe(0);
    expect(Date.parse(renewed.expires_at) - Date.parse("2026-07-05T06:10:00.000Z")).toBeGreaterThanOrEqual(
      LEASE_TTL_MS - LEASE_RENEW_COALESCE_MS,
    );
  });

  test("CAS exhaustion while still owning is retryable, not ownership loss", async () => {
    const store = new AlwaysConflictLeaseStore(
      runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 21),
    );
    const sleeps: number[] = [];

    await expect(
      renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:10:00.000Z", {
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        random: () => 0,
      }),
    ).rejects.toBeInstanceOf(WorkflowLeaseCasError);
    await expect(
      renewWorkflowLease("refresh-a", 21, store, "2026-07-05T06:10:00.000Z", timing),
    ).rejects.toThrow("CAS exhausted while renewing fencing token 21");
    expect(sleeps).toHaveLength(LEASE_CAS_ATTEMPTS - 1);
    expect(store.lease.status).toBe("running");
    expect(store.lease.fencing_token).toBe(21);
  });

  test("withholds a CDN-stale GET ETag from Blob lease CAS", async () => {
    const lease = runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 21);
    const objects = new DivergentCdnObjectStore(lease, '"cdn-old"', '"origin"');
    const store = new BlobWorkflowLeaseStore(new WorkflowLeaseWriteCache(() => 1, 0), objects);

    const snapshot = await store.read();
    expect(snapshot.lease?.run_id).toBe("refresh-a");
    expect(snapshot.etag).toBeNull();
  });

  test("uses the origin ETag when a weak CDN GET matches after normalize", async () => {
    const lease = runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 21);
    const objects = new DivergentCdnObjectStore(lease, 'W/"origin"', '"origin"');
    const store = new BlobWorkflowLeaseStore(new WorkflowLeaseWriteCache(() => 1, 0), objects);

    expect(await store.read()).toEqual({ lease, etag: '"origin"' });
  });

  test("lease create/CAS writes use max-age 0 so the public CDN cannot fence", async () => {
    const lease = runningLease("refresh-a", "2026-07-05T06:00:00.000Z", "2026-07-05T06:30:00.000Z", "manual-a", 1);
    const objects = new RecordingObjectStore();
    const store = new BlobWorkflowLeaseStore(new WorkflowLeaseWriteCache(), objects);

    expect(await store.create(lease)).toBe(true);
    expect(objects.puts[0]?.cacheControlMaxAge).toBe(LEASE_CACHE_CONTROL_MAX_AGE);
    expect(LEASE_CACHE_CONTROL_MAX_AGE).toBe(0);
    expect(await store.compareAndSet(objects.puts[0]!.etag, lease)).toBe(true);
    expect(objects.puts[1]?.cacheControlMaxAge).toBe(0);
  });
});

class StaleThenFreshLeaseStore implements WorkflowLeaseStore {
  writes = 0;
  private reads = 0;

  constructor(public lease: WorkflowLease) {}

  async read(): Promise<WorkflowLeaseSnapshot> {
    this.reads += 1;
    return {
      lease: structuredClone(this.lease),
      etag: this.reads === 1 ? '"stale"' : '"fresh"',
    };
  }

  async create(): Promise<boolean> {
    return false;
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    if (etag !== '"fresh"') return false;
    this.lease = structuredClone(lease);
    this.writes += 1;
    return true;
  }
}

class PeerRenewLeaseStore implements WorkflowLeaseStore {
  writes = 0;
  etag = '"1"';

  constructor(
    public lease: WorkflowLease,
    private readonly peerExpiresAt: string,
  ) {}

  async read(): Promise<WorkflowLeaseSnapshot> {
    return { lease: structuredClone(this.lease), etag: this.etag };
  }

  async create(): Promise<boolean> {
    return false;
  }

  async compareAndSet(): Promise<boolean> {
    this.lease = WorkflowLease.parse({ ...this.lease, expires_at: this.peerExpiresAt });
    this.etag = '"2"';
    return false;
  }
}

class AlwaysConflictLeaseStore implements WorkflowLeaseStore {
  constructor(public lease: WorkflowLease) {}

  async read(): Promise<WorkflowLeaseSnapshot> {
    return { lease: structuredClone(this.lease), etag: '"held"' };
  }

  async create(): Promise<boolean> {
    return false;
  }

  async compareAndSet(): Promise<boolean> {
    return false;
  }
}

class DivergentCdnObjectStore implements ObjectStore {
  constructor(
    private readonly lease: WorkflowLease,
    private readonly getEtag: string,
    private readonly headEtag: string,
  ) {}

  async put(): Promise<{ etag: string; url?: string }> {
    throw new Error("unexpected put");
  }

  async get(): Promise<{ body: string; etag: string | null }> {
    return { body: JSON.stringify(this.lease), etag: this.getEtag };
  }

  async head(): Promise<{ etag: string | null; contentType?: string; size?: number; url?: string }> {
    return { etag: this.headEtag, contentType: "application/json", size: 1 };
  }

  async list(): Promise<{ blobs: []; folders: []; hasMore: false }> {
    return { blobs: [], folders: [], hasMore: false };
  }

  async del(): Promise<void> {}
}

class RecordingObjectStore implements ObjectStore {
  puts: Array<{ etag: string; cacheControlMaxAge?: number; ifMatch?: string }> = [];
  private version = 0;
  private body: string | null = null;

  async put(
    _path: string,
    body: string | Uint8Array,
    options: { cacheControlMaxAge?: number; ifMatch?: string; allowOverwrite?: boolean } = {},
  ): Promise<{ etag: string }> {
    if (options.ifMatch && options.ifMatch !== this.puts.at(-1)?.etag) {
      throw Object.assign(new Error("precondition failed"), { name: "ObjectStorePreconditionFailedError" });
    }
    this.body = typeof body === "string" ? body : new TextDecoder().decode(body);
    const etag = `"v${++this.version}"`;
    this.puts.push({ etag, cacheControlMaxAge: options.cacheControlMaxAge, ifMatch: options.ifMatch });
    return { etag };
  }

  async get(): Promise<{ body: string; etag: string | null } | null> {
    if (!this.body) return null;
    return { body: this.body, etag: this.puts.at(-1)?.etag ?? null };
  }

  async head(): Promise<{ etag: string | null } | null> {
    if (!this.body) return null;
    return { etag: this.puts.at(-1)?.etag ?? null };
  }

  async list(): Promise<{ blobs: []; folders: []; hasMore: false }> {
    return { blobs: [], folders: [], hasMore: false };
  }

  async del(): Promise<void> {}
}
