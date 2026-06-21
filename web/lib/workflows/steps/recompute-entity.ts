import { loadCanonicalModel, writeVersion } from "../recompute/io";
import { computeOrgWindow, computeRepoWindow, lookups, orgEntities, repoEntities, searchIndex } from "../recompute";

// Steps 7a/7b — entity recompute. Both need the global month window: a repo's
// monthly_table.rank / rank_history is its cross-repo flow rank, so entity/repo is NOT
// bucket-local. entity/org sums member repos that span buckets (cross-bucket gather).
// See docs/VERCEL-DATA-OPERATIONS.md §3.1 (entity/repo and entity/org steps) / §3.3.

export async function recomputeRepoEntities(runId: string): Promise<{ files: number; anchorDrift: number }> {
  "use step";
  const { model } = await loadCanonicalModel(runId);
  const monthWin = computeRepoWindow(model, "month");
  const { views, anchorDrift } = repoEntities(model, monthWin);
  const files = await writeVersion(runId, views);
  return { files, anchorDrift };
}

export async function recomputeOrgEntities(runId: string): Promise<{ files: number; anchorDrift: number }> {
  "use step";
  const { model } = await loadCanonicalModel(runId);
  const monthWin = computeRepoWindow(model, "month");
  const monthOrg = computeOrgWindow(model, monthWin);
  const { views, anchorDrift } = orgEntities(model, monthOrg);
  const merged = new Map<string, unknown>([...views, ...lookups(model), ...searchIndex(model, new Date().toISOString())]);
  const files = await writeVersion(runId, merged);
  return { files, anchorDrift };
}
