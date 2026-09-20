import { loadCanonicalModel, writeVersion, writeVersionChunks } from "../recompute/io";
import { computeOrgWindow, computeRepoWindow, computePublishedStockViews, orgEntities, repoEntities, searchIndex } from "../recompute";

// Steps 7a/7b — entity recompute. Both need the global month window: a repo's
// monthly_table.rank / rank_history is its cross-repo flow rank, so entity/repo is NOT
// bucket-local. entity/org sums member repos that span buckets (cross-bucket gather).
// See docs/VERCEL-DATA-OPERATIONS.md §3.1 (entity/repo and entity/org steps) / §3.3.

export async function recomputeRepoEntities(runId: string, fencingToken: number): Promise<{ files: number; anchorDrift: number }> {
  const { model } = await loadCanonicalModel(runId, { families: ["repos", "monthly", "recentDaily"] });
  const monthWin = computeRepoWindow(model, "month");
  const { views, anchorDrift } = repoEntities(model, monthWin);
  const files = await writeVersionChunks(runId, views.entries(), { runId, fencingToken });
  return { files, anchorDrift };
}

export async function recomputeOrgEntities(runId: string, fencingToken: number): Promise<{ files: number; anchorDrift: number }> {
  const { model } = await loadCanonicalModel(runId, { families: ["repos", "monthly", "recentDaily"] });
  const monthWin = computeRepoWindow(model, "month");
  const monthOrg = computeOrgWindow(model, monthWin, { activeOnly: true });
  const generatedAt = new Date().toISOString();
  const { views, anchorDrift } = orgEntities(model, monthOrg);
  // Last writer of lookup + all-time ranks must share this model. Rank step
  // also emits all-time files; this overwrite is what validate reads.
  const files =
    (await writeVersionChunks(runId, views.entries(), { runId, fencingToken })) +
    (await writeVersion(
      runId,
      new Map<string, unknown>([...computePublishedStockViews(model, generatedAt), ...searchIndex(model, generatedAt)]),
      { runId, fencingToken },
    ));
  return { files, anchorDrift };
}
