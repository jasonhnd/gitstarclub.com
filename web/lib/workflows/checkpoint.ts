import { putView } from "@/lib/data/write";
import { WorkflowManifest } from "@/lib/contracts";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { acquireWorkflowLease, releaseWorkflowLease, workflowTriggerPeriod } from "./lease";

// Business-readable run checkpoints (ops/workflows/<run_id>/...). The Workflow SDK
// already persists step results + observability; these are the operator-facing
// runbook artifacts. All writes are I/O, so each is its own "use step" (workflow
// bodies must stay deterministic). See docs/VERCEL-DATA-OPERATIONS.md §3.1/§9.

const STEPS = ["whitelist", "rename", "metadata", "fold", "recompute", "buildAliases", "validate", "publish", "gc"];
/** Write the initial manifest (status=running); returns started_at for later updates. */
export async function startRun(runId: string, triggerPeriod = workflowTriggerPeriod()): Promise<string> {
  "use step";
  const startedAt = new Date().toISOString();
  const lease = await acquireWorkflowLease({ runId, triggerPeriod, requestedAt: new Date(startedAt) });
  if (lease.action === "conflict" || (lease.action === "attached" && lease.runId !== runId)) {
    throw new Error(`workflow ${lease.runId} already owns refresh period ${lease.triggerPeriod}`);
  }
  const manifest = { run_id: runId, started_at: startedAt, status: "running", steps: STEPS, published_version: null };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  return startedAt;
}

/** Mark the run published after publishVersion has already written latest-success. */
export async function markPublished(runId: string, startedAt: string): Promise<void> {
  "use step";
  const manifest = { run_id: runId, started_at: startedAt, status: "published", steps: STEPS, published_version: runId };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  await releaseWorkflowLease(runId, "published");
  // Best-effort health beacon for the success path (never throws).
  await recordHealth("workflow-refresh", "ok", { run_id: runId });
}

/** Mark the run failed; line on Blob does not flip latest-success (line stays at last good run). */
export async function markFailed(runId: string, startedAt: string, error: string): Promise<void> {
  "use step";
  const manifest = { run_id: runId, started_at: startedAt, status: "failed", steps: STEPS, published_version: null };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  await putView(`ops/workflows/${runId}/error.json`, { run_id: runId, error, at: new Date().toISOString() });
  await releaseWorkflowLease(runId, "failed");
  // Surface the failure: greppable log + optional webhook + health beacon. None of these throw.
  await sendAlert({ pipeline: "workflow-refresh", title: "managed refresh failed", run_id: runId, error });
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error });
}

export async function markStartFailed(runId: string, error: string): Promise<void> {
  await putView(`ops/workflows/${runId}/error.json`, { run_id: runId, error, at: new Date().toISOString() });
  await releaseWorkflowLease(runId, "failed");
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error });
}
