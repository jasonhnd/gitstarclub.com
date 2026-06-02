import { putView } from "@/lib/data/write";
import { WorkflowManifest } from "@/lib/contracts";

// Business-readable run checkpoints (ops/workflows/<run_id>/...). The Workflow SDK
// already persists step results + observability; these are the operator-facing
// runbook artifacts. All writes are I/O, so each is its own "use step" (workflow
// bodies must stay deterministic). See docs/VERCEL-DATA-OPERATIONS.md §3.4/§8.

const STEPS = ["whitelist", "rename", "metadata"];

/** Write the initial manifest (status=running); returns started_at for later updates. */
export async function startRun(runId: string): Promise<string> {
  "use step";
  const startedAt = new Date().toISOString();
  const manifest = { run_id: runId, started_at: startedAt, status: "running", steps: STEPS, published_version: null };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  return startedAt;
}

/** Mark the run published (Phase 2: canonical/v2 refreshed) + record the recovery point. */
export async function markPublished(runId: string, startedAt: string): Promise<void> {
  "use step";
  const manifest = { run_id: runId, started_at: startedAt, status: "published", steps: STEPS, published_version: runId };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  await putView("ops/workflows/latest-success.json", {
    run_id: runId,
    version: runId,
    published_at: new Date().toISOString(),
  });
}

/** Mark the run failed; line on Blob does not flip latest-success (line stays at last good run). */
export async function markFailed(runId: string, startedAt: string, error: string): Promise<void> {
  "use step";
  const manifest = { run_id: runId, started_at: startedAt, status: "failed", steps: STEPS, published_version: null };
  WorkflowManifest.parse(manifest);
  await putView(`ops/workflows/${runId}/manifest.json`, manifest);
  await putView(`ops/workflows/${runId}/error.json`, { run_id: runId, error, at: new Date().toISOString() });
}
