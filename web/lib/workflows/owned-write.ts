import { createView, putView } from "@/lib/data/write";
import {
  LEASE_HEARTBEAT_INTERVAL_MS,
  renewWorkflowLease,
  type WorkflowOwnership,
} from "@/lib/workflows/lease";

/** Renew immediately before a mutable Workflow artifact is written. */
export async function putOwnedView(owner: WorkflowOwnership, path: string, data: unknown): Promise<void> {
  await renewWorkflowLease(owner.runId, owner.fencingToken);
  await putView(path, data);
}

/** Create an immutable Workflow artifact while proving current ownership. */
export async function createOwnedView(owner: WorkflowOwnership, path: string, data: unknown): Promise<boolean> {
  await renewWorkflowLease(owner.runId, owner.fencingToken);
  return createView(path, data);
}

type OwnershipRenewer = (runId: string, fencingToken: number) => Promise<unknown>;

/**
 * Coalesces concurrent workers onto one lease renewal and keeps long-running
 * version writes inside the documented heartbeat bound.
 */
export function workflowHeartbeat(
  owner: WorkflowOwnership,
  renew: OwnershipRenewer = renewWorkflowLease,
): () => Promise<void> {
  let nextHeartbeatAt = 0;
  let pending: Promise<void> | null = null;
  return async () => {
    if (Date.now() < nextHeartbeatAt) return;
    pending ??= renew(owner.runId, owner.fencingToken)
      .then(() => {
        nextHeartbeatAt = Date.now() + LEASE_HEARTBEAT_INTERVAL_MS;
      })
      .finally(() => {
        pending = null;
      });
    await pending;
  };
}
