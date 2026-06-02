import { refreshWhitelist } from "./steps/whitelist";
import { detectRenames } from "./steps/rename";
import { refreshMetadataBucket } from "./steps/metadata";
import { startRun, markPublished, markFailed } from "./checkpoint";
import { REPO_BUCKETS } from "./buckets";

// Phase 2 managed-refresh workflow: whitelist → rename → metadata (per bucket).
// Rename runs before metadata so it can read the previous full_name before it is
// overwritten. Metadata seeds existing repos from bootstrap data (lookup) and
// only hits GitHub for genuine newcomers, so the per-bucket steps stay cheap and
// GitHub's secondary rate limit is never tripped.
// Started by the cron route (/api/workflows/refresh/start). See VERCEL-DATA-OPERATIONS §3.

export async function refreshWorkflow(runId: string) {
  "use workflow";

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
    await markPublished(runId, startedAt);
    return { runId, ok: true, whitelist, rename, metadata };
  } catch (err) {
    await markFailed(runId, startedAt, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
