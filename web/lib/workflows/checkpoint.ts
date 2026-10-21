import { readAuthoritativeView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { ViewsPointer, WorkflowManifest } from "@/lib/contracts";
import { sendAlert } from "@/lib/observability/alert";
import { recordHealth } from "@/lib/observability/health";
import { sanitizeErrorText } from "@/lib/observability/sanitize-error";
import { logViewParseErrorSummary } from "@/lib/data/parse-view";
import { createView } from "@/lib/data/write";
import { blobWorkflowLeaseStore, claimWorkflowLease, releaseWorkflowLease, WorkflowLeaseCasError } from "@/lib/workflows/lease";
import { putOwnedView } from "@/lib/workflows/owned-write";

// Business-readable run checkpoints (ops/workflows/<run_id>/...). The refresh
// runtime persists queue/HTTP progress separately; these are the operator-facing
// runbook artifacts written through the P0 object-store port. See
// docs/VERCEL-DATA-OPERATIONS.md §3.1/§9 and docs/CF-MIGRATION-P1.md.

const STEPS = ["preflight", "whitelist", "rename", "metadata", "fold", "recompute", "buildAliases", "validate", "publish", "gc"];

/** Write the initial manifest (status=running); returns started_at for later updates. */
export async function startRun(runId: string): Promise<{ startedAt: string; fencingToken: number }> {
  const startedAt = new Date().toISOString();
  const claim = await claimWorkflowLease({
    runId,
    acquiredAt: startedAt,
    idempotencyKey: `run:${runId}`,
    trigger: "workflow",
    allowExistingRun: true,
  });
  if (claim.lease.run_id !== runId || claim.status === "rejected") {
    throw new Error(`workflow ${claim.lease.run_id} is already running until ${claim.lease.expires_at}`);
  }
  const manifest = { run_id: runId, started_at: startedAt, status: "running", steps: STEPS, published_version: null };
  WorkflowManifest.parse(manifest);
  const owner = { runId, fencingToken: claim.lease.fencing_token };
  await putOwnedView(owner, `ops/workflows/${runId}/manifest.json`, manifest);
  return { startedAt, fencingToken: owner.fencingToken };
}

/** Mark the run published after publishVersion has already written latest-success. */
export async function markPublished(runId: string, startedAt: string, fencingToken: number): Promise<void> {
  const manifest = { run_id: runId, started_at: startedAt, status: "published", steps: STEPS, published_version: runId };
  WorkflowManifest.parse(manifest);
  await putOwnedView({ runId, fencingToken }, `ops/workflows/${runId}/manifest.json`, manifest);
  const released = await releaseWorkflowLease(runId, "published", undefined, undefined, fencingToken);
  if (!released) throw new Error(`workflow ${runId} lost fencing token ${fencingToken} before published release`);
  // Best-effort health beacon for the success path (never throws).
  await recordHealth("workflow-refresh", "ok", { run_id: runId });
  logViewParseErrorSummary("[workflow-refresh]");
}

/**
 * A failure around the publication commit. `post_commit`: `views/latest.json`
 * already serves `version` and `step` did not finish. `commit_unknown`: `step`
 * failed and the pointer could not be read to tell whether `version` is live.
 */
export type PublicationFailure = {
  phase: "post_commit" | "commit_unknown";
  version: string;
  step: string;
};

function failureRecord(runId: string, error: string, publication: PublicationFailure | undefined) {
  const base = { run_id: runId, error, at: new Date().toISOString() };
  if (!publication) return { ...base, phase: "pre_commit" };
  const version =
    publication.phase === "post_commit"
      ? { committed_version: publication.version }
      : { candidate_version: publication.version };
  return { ...base, phase: publication.phase, ...version, failed_step: publication.step };
}

function failureAlertTitle(publication: PublicationFailure | undefined): string {
  if (!publication) return "managed refresh failed";
  if (publication.phase === "post_commit") return "managed refresh published; post-commit step failed";
  return "managed refresh failed; publication commit state unknown";
}

/**
 * Mark the run failed. Before the pointer commit, latest-success stays at the
 * last good run and `published_version` is null. After it, `published_version`
 * names the live version and error.json names the step that did not finish:
 * do not roll back or rerun for it, the next successful run rewrites that
 * step's artifacts. An unknown commit state keeps `published_version` null and
 * names the candidate version, so operators check `views/latest.json`.
 */
export async function markFailed(
  runId: string,
  startedAt: string,
  error: string,
  fencingToken: number,
  publication?: PublicationFailure,
): Promise<void> {
  const safeError = sanitizeErrorText(error);
  const manifest = {
    run_id: runId,
    started_at: startedAt,
    status: "failed",
    steps: STEPS,
    published_version: publication?.phase === "post_commit" ? publication.version : null,
  };
  WorkflowManifest.parse(manifest);
  const owner = { runId, fencingToken };
  await putOwnedView(owner, `ops/workflows/${runId}/manifest.json`, manifest);
  await putOwnedView(owner, `ops/workflows/${runId}/error.json`, failureRecord(runId, safeError, publication));
  const released = await releaseWorkflowLease(runId, "failed", undefined, undefined, fencingToken);
  if (!released) throw new Error(`workflow ${runId} lost fencing token ${fencingToken} before failed release`);
  // Surface the failure: greppable log + optional webhook + health beacon. None of these throw.
  const title = failureAlertTitle(publication);
  await sendAlert(
    publication
      ? { pipeline: "workflow-refresh", title, run_id: runId, step: publication.step, error: safeError }
      : { pipeline: "workflow-refresh", title, run_id: runId, error: safeError },
  );
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error: safeError });
  logViewParseErrorSummary("[workflow-refresh]");
}

/**
 * Durable record of a post-commit lease loss. The pointer switched, then this
 * run lost its lease, so `markFailed` cannot renew it and writes nothing: the
 * running manifest would keep `published_version: null`. This writes one
 * create-only file under the run's own prefix. It does not renew, release, or
 * overwrite any lease, and it touches no shared pointer or successor artifact.
 * An existing record is kept (returns false). Alert and health still fire.
 */
export async function recordPostCommitLeaseLoss(
  runId: string,
  startedAt: string,
  error: string,
  publication: PublicationFailure,
): Promise<boolean> {
  const safeError = sanitizeErrorText(error);
  const record = {
    run_id: runId,
    started_at: startedAt,
    status: "failed",
    phase: "post_commit",
    published_version: publication.version,
    failed_step: publication.step,
    error: safeError,
    at: new Date().toISOString(),
  };
  const created = await createView(`ops/workflows/${runId}/post-commit-failure.json`, record);
  await sendAlert({
    pipeline: "workflow-refresh",
    title: failureAlertTitle(publication),
    run_id: runId,
    step: publication.step,
    error: safeError,
  });
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error: safeError });
  return created;
}

/**
 * Terminal diagnostics for an exhausted invocation. These are run-scoped only:
 * no expired lease is renewed and no successor's lease/pointer is overwritten.
 * Release is conditional on the original run and token, even after expiry.
 */
export async function recordDeferredFailure(
  runId: string,
  startedAt: string,
  fencingToken: number,
  error: string,
  publication?: PublicationFailure,
): Promise<void> {
  const existing = await readAuthoritativeView(`ops/workflows/${runId}/manifest.json`, WorkflowManifest, { bust: runId });
  if (existing?.status === "published") return;
  if (publication?.phase === "commit_unknown") {
    try {
      const pointer = await readAuthoritativeView("views/latest.json", ViewsPointer, { bust: runId });
      publication = pointer?.version === publication.version
        ? { ...publication, phase: "post_commit" }
        : undefined;
    } catch {
      // Retain commit_unknown when the authoritative pointer is unavailable.
    }
  }
  const safeError = sanitizeErrorText(error);
  await putView(`ops/workflows/${runId}/error.json`, failureRecord(runId, safeError, publication));
  await putView(`ops/workflows/${runId}/manifest.json`, WorkflowManifest.parse({
    run_id: runId, started_at: startedAt, status: "failed", steps: STEPS,
    published_version: publication?.phase === "post_commit" ? publication.version : null,
  }));
  const released = await releaseWorkflowLease(runId, "failed", undefined, undefined, fencingToken);
  if (!released) {
    const current = await blobWorkflowLeaseStore.read();
    if (current.lease?.run_id === runId && current.lease.fencing_token === fencingToken && current.lease.status === "running") {
      throw new WorkflowLeaseCasError(`workflow ${runId}: retry terminal lease release in a fresh invocation`);
    }
  }
  await sendAlert({ pipeline: "workflow-refresh", title: failureAlertTitle(publication), run_id: runId, error: safeError });
  await recordHealth("workflow-refresh", "failed", { run_id: runId, error: safeError });
}
