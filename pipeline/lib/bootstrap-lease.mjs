// Bootstrap commit/rollback shares the managed-refresh active lease. This
// closes the read-check-write race: a Workflow cannot start between bootstrap
// validation and the one-file pointer switch, and stale owners stay fenced.

export const ACTIVE_WORKFLOW_PATH = "ops/workflows/active.json";
const BOOTSTRAP_LEASE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

function parseLease(body) {
  if (!body) return null;
  let lease;
  try {
    lease = JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`cannot parse ${ACTIVE_WORKFLOW_PATH}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (
    typeof lease?.run_id !== "string" ||
    !["running", "published", "failed"].includes(lease?.status) ||
    !Number.isFinite(Date.parse(lease?.expires_at)) ||
    !Number.isInteger(lease?.fencing_token) ||
    lease.fencing_token < 0
  ) {
    throw new Error(`${ACTIVE_WORKFLOW_PATH}: invalid workflow lease`);
  }
  return lease;
}

function leaseBody(lease) {
  return Buffer.from(JSON.stringify(lease));
}

export async function acquireBootstrapLease({ store, generation, operation, now = Date.now() }) {
  const acquiredAt = new Date(now).toISOString();
  const runId = `bootstrap-${operation}-${generation}`;
  const idempotencyKey = `bootstrap:${operation}:${generation}`;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const snapshot = await store.readSnapshot(ACTIVE_WORKFLOW_PATH);
    const active = parseLease(snapshot.body);
    if (active?.status === "running" && Date.parse(active.expires_at) > now) {
      throw new Error(`bootstrap ${operation} blocked by active workflow ${active.run_id} until ${active.expires_at}`);
    }
    const lease = {
      run_id: runId,
      status: "running",
      acquired_at: acquiredAt,
      expires_at: new Date(now + BOOTSTRAP_LEASE_TTL_MS).toISOString(),
      fencing_token: (active?.fencing_token ?? 0) + 1,
      idempotency_key: idempotencyKey,
      trigger: "bootstrap-cli",
    };
    const acquired = snapshot.etag
      ? await store.compareAndSet(ACTIVE_WORKFLOW_PATH, snapshot.etag, leaseBody(lease))
      : await store.createMutable(ACTIVE_WORKFLOW_PATH, leaseBody(lease));
    if (acquired) return lease;
  }
  throw new Error(`failed to acquire ${ACTIVE_WORKFLOW_PATH} after concurrent updates`);
}

export async function releaseBootstrapLease({ store, lease, status, now = Date.now() }) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const snapshot = await store.readSnapshot(ACTIVE_WORKFLOW_PATH);
    const current = parseLease(snapshot.body);
    if (
      !current ||
      current.run_id !== lease.run_id ||
      current.fencing_token !== lease.fencing_token ||
      !snapshot.etag
    ) {
      return false;
    }
    const at = new Date(now).toISOString();
    const released = {
      ...current,
      status,
      acquired_at: at,
      expires_at: at,
    };
    if (await store.compareAndSet(ACTIVE_WORKFLOW_PATH, snapshot.etag, leaseBody(released))) return true;
  }
  return false;
}

export async function withBootstrapPublicationLease({ store, generation, operation, run }) {
  /** @type {any} */
  let lease = null;
  let succeeded = false;
  try {
    const result = await run(async () => {
      lease = await acquireBootstrapLease({ store, generation, operation });
    });
    if (!lease) throw new Error(`bootstrap ${operation} did not acquire the shared workflow lease`);
    succeeded = true;
    return result;
  } finally {
    if (lease) {
      const released = await releaseBootstrapLease({
        store,
        lease,
        status: succeeded ? "published" : "failed",
      });
      if (!released) throw new Error(`bootstrap ${operation} lost workflow lease ${lease.fencing_token} before release`);
    }
  }
}
