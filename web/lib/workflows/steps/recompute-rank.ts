import { loadCanonicalModel, writeVersion } from "../recompute/io";
import { computeCategoryViews, computeRankViews } from "../recompute";

// Step 6 — rank recompute (cross-bucket gather). Loads the full canonical model and
// writes the rank matrix (window × dim × metric) + all-time + growth + newcomers to
// views/<run_id>/rank/**. rank/all-time/org need every repo, so this cannot be bucketed.
// See docs/VERCEL-DATA-OPERATIONS.md §3 (step 6) / §3.3.

export async function recomputeRank(runId: string): Promise<{ files: number }> {
  "use step";
  const { model } = await loadCanonicalModel(runId);
  const generatedAt = new Date().toISOString();
  const views = new Map<string, unknown>(computeRankViews(model, generatedAt));
  for (const [path, view] of computeCategoryViews(model, generatedAt)) views.set(path, view);
  const files = await writeVersion(runId, views);
  return { files };
}
