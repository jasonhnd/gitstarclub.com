import { refreshWhitelist } from "./steps/whitelist";
import { detectRenames } from "./steps/rename";
import { refreshMetadataBucket } from "./steps/metadata";
import { foldCanonical } from "./steps/fold";
import { recomputeRank } from "./steps/recompute-rank";
import { recomputeRepoEntities, recomputeOrgEntities } from "./steps/recompute-entity";
import { recomputeHeatmap } from "./steps/recompute-heatmap";
import { buildAliases } from "./steps/aliases";
import { validateVersion } from "./steps/validate";
import { publishVersion } from "./steps/publish";
import { gcVersions } from "./steps/gc";
import { startRun, markPublished, markFailed } from "./checkpoint";
import { REPO_BUCKETS } from "./buckets";
import { sendAlert } from "@/lib/observability/alert";
import { preflightCanonical } from "./steps/preflight";
import { withStepRetry } from "./runtime/retry";

// Phase 2+4 managed-refresh:
//   whitelist → rename → metadata (per bucket)
//   → recompute rank/entity/heatmap into views/<run_id>/** → validate → publish pointer.
// Steps are ordinary async functions with explicit retry. The start route enqueues
// them through the workflows runtime (memory / HTTP chain / CF Queue) instead of
// the Vercel Workflow SDK. See VERCEL-DATA-OPERATIONS §3 and CF-MIGRATION-P1.

export async function refreshWorkflow(runId: string) {
  const { startedAt, fencingToken } = await withStepRetry("startRun", () => startRun(runId));
  try {
    // Fail before whitelist/canonical writes when the deployed bootstrap shape
    // cannot be consumed by the managed refresh.
    const preflight = await withStepRetry("preflight", () => preflightCanonical(runId, fencingToken));
    const whitelist = await withStepRetry("whitelist", () => refreshWhitelist(runId, fencingToken));
    const rename = await withStepRetry("rename", () => detectRenames(runId, fencingToken));

    let repos = 0;
    let historical = 0;
    let fromGithub = 0;
    for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
      const r = await withStepRetry(`metadata-${bucket}`, () => refreshMetadataBucket(runId, bucket, fencingToken));
      repos += r.repos;
      historical += r.historical;
      fromGithub += r.from_github;
    }
    const metadata = { repos, active: repos, historical, buckets: REPO_BUCKETS, from_github: fromGithub };

    // fold any closed months (live overlay → canonical) so the recompute below includes them.
    const fold = await withStepRetry("fold", () => foldCanonical(runId, fencingToken));

    // recompute the full view matrix into the run's versioned prefix (does not touch live).
    // Org-entity is the last writer of lookup + all-time stock ranks (one model).
    const rank = await withStepRetry("recomputeRank", () => recomputeRank(runId, fencingToken));
    const repoEntities = await withStepRetry("recomputeRepoEntities", () => recomputeRepoEntities(runId, fencingToken));
    const orgEntities = await withStepRetry("recomputeOrgEntities", () => recomputeOrgEntities(runId, fencingToken));
    const heatmap = await withStepRetry("recomputeHeatmap", () => recomputeHeatmap(runId, fencingToken));
    const recompute = {
      rank: rank.files,
      repo_entities: repoEntities.files,
      org_entities: orgEntities.files,
      heatmap: heatmap.files,
    };

    // accumulate renamed-away full_names → current id so the repo route 308-redirects stale URLs.
    const aliases = await withStepRetry("aliases", () => buildAliases(runId, fencingToken));

    // publish gate: validate the version, then atomically flip the pointer.
    const validation = await withStepRetry("validate", () => validateVersion(runId, fencingToken));
    const publish = await withStepRetry("publish", () => publishVersion(runId, fencingToken));

    // GC is best-effort, but its destructive calls stay inside this run's
    // shared publication lease. markPublished releases that lease only after
    // GC has finished or failed closed.
    const gc = await withStepRetry("gc", () => gcVersions(runId, fencingToken));
    await withStepRetry("markPublished", () => markPublished(runId, startedAt, fencingToken));
    if (gc.error) await sendAlert({ pipeline: "workflow-refresh", title: "version gc failed", run_id: runId, step: "gc", error: gc.error });
    return { runId, ok: true, preflight, whitelist, rename, metadata, fold, recompute, aliases, validation, publish, gc };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await markFailed(runId, startedAt, message, fencingToken);
    } catch (checkpointError) {
      throw new Error(`${message}; failed to record/release failed run: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`);
    }
    throw err;
  }
}
