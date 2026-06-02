import { refreshWhitelist } from "./steps/whitelist";
import { detectRenames } from "./steps/rename";
import { refreshMetadataShards } from "./steps/metadata";
import { startRun, markPublished, markFailed } from "./checkpoint";

// Phase 2 managed-refresh workflow: whitelist → rename → metadata. Rename runs
// before metadata so it can read the previous full_name before it is overwritten.
// Started by the cron route (/api/workflows/refresh/start). Each named call is a
// durable step. See docs/VERCEL-DATA-OPERATIONS.md §3.

export async function refreshWorkflow(runId: string) {
  "use workflow";

  const startedAt = await startRun(runId);
  try {
    const whitelist = await refreshWhitelist(runId);
    const rename = await detectRenames(runId);
    const metadata = await refreshMetadataShards(runId);
    await markPublished(runId, startedAt);
    return { runId, ok: true, whitelist, rename, metadata };
  } catch (err) {
    await markFailed(runId, startedAt, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
