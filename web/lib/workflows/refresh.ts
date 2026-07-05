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
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";

// Phase 2+4 managed-refresh workflow:
//   whitelist → rename → metadata (per bucket)
//   → recompute rank/entity/heatmap into views/<run_id>/** → validate → publish pointer.
// Rename runs before metadata so it can read the previous full_name before it is overwritten.
// Recompute reads the canonical/v2 shards (refreshed by metadata) and the frozen anchoring factor d, so
// stock curves stay seam-anchored. Validation gates the pointer switch: a bad recompute never
// goes live. Started by the cron route (/api/workflows/refresh/start). See VERCEL-DATA-OPERATIONS §3.

export async function refreshWorkflow(runId: string) {
  "use workflow";

  requireBlobBaseUrl();
  requireBlobWriteToken();
  requireGithubToken();

  const startedAt = await startRun(runId);
  try {
    const whitelist = await refreshWhitelist(runId);
    const rename = await detectRenames(runId);

    let repos = 0;
    let fromGithub = 0;
    for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
      const r = await refreshMetadataBucket(runId, bucket);
      repos += r.repos;
      fromGithub += r.from_github;
    }
    const metadata = { repos, buckets: REPO_BUCKETS, from_github: fromGithub };

    // fold any closed months (live overlay → canonical) so the recompute below includes them.
    const fold = await foldCanonical(runId);

    // recompute the full view matrix into the run's versioned prefix (does not touch live).
    const rank = await recomputeRank(runId);
    const repoEntities = await recomputeRepoEntities(runId);
    const orgEntities = await recomputeOrgEntities(runId);
    const heatmap = await recomputeHeatmap(runId);
    const recompute = {
      rank: rank.files,
      repo_entities: repoEntities.files,
      org_entities: orgEntities.files,
      heatmap: heatmap.files,
    };

    // accumulate renamed-away full_names → current id so the repo route 308-redirects stale URLs.
    const aliases = await buildAliases(runId);

    // publish gate: validate the version, then atomically flip the pointer.
    const validation = await validateVersion(runId);
    const publish = await publishVersion(runId);

    await markPublished(runId, startedAt);
    const gc = await gcVersions(runId); // best-effort cleanup of old versions; never fails the run
    if (gc.error) await sendAlert({ pipeline: "workflow-refresh", title: "version gc failed", run_id: runId, step: "gc", error: gc.error });
    return { runId, ok: true, whitelist, rename, metadata, fold, recompute, aliases, validation, publish, gc };
  } catch (err) {
    await markFailed(runId, startedAt, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
