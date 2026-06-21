import { putView } from "@/lib/data/write";
import { readView } from "@/lib/data/source";
import { WorkflowLease, WorkflowManifest } from "@/lib/contracts";
import { recordHealth, sendAlert } from "@/lib/observability/alert";

// Business-readable run checkpoints (ops/workflows/<run_id>/...). The Workflow SDK
// already persists step results + observability; these are the operator-facing
// runbook artifacts. All writes are I/O, so each is its own "use step" (workflow
// bodies must stay deterministic). See docs/VERCEL-DATA-OPERATIONS.md §3.1/§9.

const STEPS = ["whitelist", "rename", "metadata", "fold", "recompute", "buildAliases", "validate", "publish", "gc"];
const ACTIVE_PATH = "ops/workflows/active.json";
const LEASE_TTL_MS = 12 * 60 * 60 * 1000;

/** Write the initial manifest (status=running); returns started_at for later updates. */
export async function startRun(runId: string): Promise<string> {
  "use step";
  const startedAt = new Date().toISOString();
  await acquireLease(runId, startedAt);
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
  await releaseLease(runId, "published");
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
  await releaseLease(runId, "failed");
  // Surface the failure: greppable log + optional webhook + health beacon. None of these throw.
  await sendAlert({ pipeline: "workflow-refresh", title: "managed refresh failed", run_id: runId, error });
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error });
}

async function acquireLease(runId: string, acquiredAt: string): Promise<void> {
  const active = await readView(ACTIVE_PATH, WorkflowLease, { bust: runId });
  const now = Date.now();
  if (active?.status === "running" && active.run_id !== runId && Date.parse(active.expires_at) > now) {
    throw new Error(`workflow ${active.run_id} is already running until ${active.expires_at}`);
  }
  const lease = {
    run_id: runId,
    status: "running",
    acquired_at: acquiredAt,
    expires_at: new Date(now + LEASE_TTL_MS).toISOString(),
  };
  WorkflowLease.parse(lease);
  await putView(ACTIVE_PATH, lease);
}

async function releaseLease(runId: string, status: "published" | "failed"): Promise<void> {
  const now = new Date();
  const lease = {
    run_id: runId,
    status,
    acquired_at: now.toISOString(),
    expires_at: now.toISOString(),
  };
  WorkflowLease.parse(lease);
  await putView(ACTIVE_PATH, lease);
}
