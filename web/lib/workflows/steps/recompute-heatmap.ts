import { loadCanonicalModel, writeVersion } from "../recompute/io";
import { heatmaps } from "../recompute";

// Step 8 — heatmap + version meta. Site-wide daily totals → month files; monthly totals
// → year files. Also writes the version's meta.json (seam_date + folded_through) that the
// read side uses for the live-overlay watermark. See docs/VERCEL-DATA-OPERATIONS.md §3 (step 8) / §8.3.

export async function recomputeHeatmap(runId: string): Promise<{ files: number }> {
  "use step";
  const { model, seamDate, foldedThrough } = await loadCanonicalModel(runId);
  const gen = new Date().toISOString();
  const views = new Map<string, unknown>(heatmaps(model.siteDaily, gen));
  views.set("meta.json", { seam_date: seamDate, schema_ver: 1, folded_through: foldedThrough, generated_at: gen });
  const files = await writeVersion(runId, views);
  return { files };
}
