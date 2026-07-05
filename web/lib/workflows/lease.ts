import { WorkflowLease } from "@/lib/contracts";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { putView } from "@/lib/data/write";
import { requireBlobBaseUrl } from "@/lib/runtime-config";
import { currentUtcPeriods } from "@/lib/periods";

export const ACTIVE_LEASE_PATH = "ops/workflows/active.json";
export const DEFAULT_LEASE_TTL_MS = 12 * 60 * 60 * 1000;

export interface StoredWorkflowLease {
  lease: WorkflowLease;
  etag: string;
}

export interface WorkflowLeaseStore {
  readActive(bust: string): Promise<StoredWorkflowLease | null>;
  createActive(lease: WorkflowLease): Promise<"created" | "conflict">;
  updateActive(lease: WorkflowLease, etag: string): Promise<"updated" | "conflict">;
}

export type WorkflowLeaseDecision =
  | { action: "acquired" | "taken_over"; lease: WorkflowLease; runId: string; triggerPeriod: string }
  | { action: "attached"; lease: WorkflowLease; runId: string; triggerPeriod: string; reason: "same_period" | "same_run" }
  | { action: "conflict"; lease: WorkflowLease; runId: string; triggerPeriod: string; reason: string };

export interface AcquireWorkflowLeaseOptions {
  runId: string;
  triggerPeriod: string;
  requestedAt?: Date;
  ttlMs?: number;
  store?: WorkflowLeaseStore;
}

export function workflowTriggerPeriod(now = new Date()): string {
  return currentUtcPeriods(now).weekPeriod;
}

export function workflowIdempotencyKey(triggerPeriod: string): string {
  return `refresh:${triggerPeriod}`;
}

export function workflowRunId(now = new Date()): string {
  return `refresh-${now.toISOString().replaceAll(/[:.]/g, "-")}`;
}

export function defaultWorkflowLeaseStore(): WorkflowLeaseStore {
  return blobWorkflowLeaseStore;
}

export async function acquireWorkflowLease(options: AcquireWorkflowLeaseOptions): Promise<WorkflowLeaseDecision> {
  const store = options.store ?? defaultWorkflowLeaseStore();
  const requestedAt = options.requestedAt ?? new Date();
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
  const requestedAtIso = requestedAt.toISOString();
  const expiresAt = new Date(requestedAt.getTime() + ttlMs).toISOString();
  const nextLease = WorkflowLease.parse({
    run_id: options.runId,
    status: "running",
    acquired_at: requestedAtIso,
    expires_at: expiresAt,
    trigger_period: options.triggerPeriod,
    idempotency_key: workflowIdempotencyKey(options.triggerPeriod),
    last_event: "acquired",
    last_triggered_at: requestedAtIso,
  });

  for (let attempt = 0; attempt < 4; attempt++) {
    const active = await store.readActive(`${options.runId}-${attempt}`);
    if (!active) {
      const created = await store.createActive(nextLease);
      if (created === "created") {
        return { action: "acquired", lease: nextLease, runId: options.runId, triggerPeriod: options.triggerPeriod };
      }
      continue;
    }

    const decision = decideLease(active.lease, options.runId, options.triggerPeriod, requestedAt);
    if (decision === "same_run" || decision === "same_period") {
      return {
        action: "attached",
        lease: active.lease,
        runId: active.lease.run_id,
        triggerPeriod: active.lease.trigger_period ?? options.triggerPeriod,
        reason: decision,
      };
    }
    if (decision === "conflict") {
      return {
        action: "conflict",
        lease: active.lease,
        runId: active.lease.run_id,
        triggerPeriod: active.lease.trigger_period ?? options.triggerPeriod,
        reason: `workflow ${active.lease.run_id} is already running until ${active.lease.expires_at}`,
      };
    }

    const takeover = WorkflowLease.parse({ ...nextLease, last_event: "taken_over" });
    const updated = await store.updateActive(takeover, active.etag);
    if (updated === "updated") {
      return { action: "taken_over", lease: takeover, runId: options.runId, triggerPeriod: options.triggerPeriod };
    }
  }

  const latest = await store.readActive(options.runId);
  if (latest) {
    return {
      action: "conflict",
      lease: latest.lease,
      runId: latest.lease.run_id,
      triggerPeriod: latest.lease.trigger_period ?? options.triggerPeriod,
      reason: "workflow lease changed during acquisition",
    };
  }

  return {
    action: "conflict",
    lease: nextLease,
    runId: options.runId,
    triggerPeriod: options.triggerPeriod,
    reason: "workflow lease acquisition did not converge",
  };
}

export async function releaseWorkflowLease(
  runId: string,
  status: "published" | "failed",
  options: { releasedAt?: Date; store?: WorkflowLeaseStore } = {},
): Promise<void> {
  const store = options.store ?? defaultWorkflowLeaseStore();
  const releasedAt = options.releasedAt ?? new Date();
  const active = await store.readActive(runId);
  if (!active || active.lease.run_id !== runId) return;

  const released = WorkflowLease.parse({
    ...active.lease,
    status,
    expires_at: releasedAt.toISOString(),
    last_event: "released",
  });
  await store.updateActive(released, active.etag);
}

function decideLease(
  active: WorkflowLease,
  requestedRunId: string,
  requestedTriggerPeriod: string,
  now: Date,
): "same_run" | "same_period" | "conflict" | "takeover" {
  if (active.run_id === requestedRunId) return "same_run";
  const running = active.status === "running";
  const expiresAt = Date.parse(active.expires_at);
  const runningAndFresh = running && Number.isFinite(expiresAt) && expiresAt > now.getTime();
  if (active.trigger_period === requestedTriggerPeriod && (runningAndFresh || active.status === "published")) return "same_period";
  if (runningAndFresh) return "conflict";
  return "takeover";
}

const blobWorkflowLeaseStore: WorkflowLeaseStore = {
  async readActive(bust: string): Promise<StoredWorkflowLease | null> {
    const base = requireBlobBaseUrl();
    const res = await fetchWithTimeout(
      `${base}/${ACTIVE_LEASE_PATH}?v=${encodeURIComponent(bust)}`,
      { cache: "no-store" },
      { timeoutMs: 10_000, label: "Workflow active lease fetch" },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`workflow active lease fetch failed: ${res.status}`);
    const etag = res.headers.get("etag");
    if (!etag) throw new Error("workflow active lease missing ETag");
    return { lease: WorkflowLease.parse(await res.json()), etag };
  },
  async createActive(lease: WorkflowLease): Promise<"created" | "conflict"> {
    try {
      await putView(ACTIVE_LEASE_PATH, lease, { allowOverwrite: false });
      return "created";
    } catch (error) {
      if (isBlobWriteConflict(error)) return "conflict";
      throw error;
    }
  },
  async updateActive(lease: WorkflowLease, etag: string): Promise<"updated" | "conflict"> {
    try {
      await putView(ACTIVE_LEASE_PATH, lease, { allowOverwrite: true, ifMatch: etag });
      return "updated";
    } catch (error) {
      if (isBlobWriteConflict(error)) return "conflict";
      throw error;
    }
  },
};

function isBlobWriteConflict(error: unknown): boolean {
  const maybe = error as { name?: string; status?: number; statusCode?: number };
  const message = error instanceof Error ? error.message : String(error);
  return (
    maybe.status === 409 ||
    maybe.status === 412 ||
    maybe.statusCode === 409 ||
    maybe.statusCode === 412 ||
    maybe.name === "BlobPreconditionFailedError" ||
    /already exists|conflict|precondition|etag|ifMatch/i.test(message)
  );
}
