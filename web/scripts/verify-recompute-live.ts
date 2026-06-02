// Live-glue verification (no publish): load the canonical model from Blob, recompute the
// full view matrix, write it to a throwaway versioned prefix views/<verify-run>/**, and run
// the validate step against it. Proves io.ts + validate + the Blob path end-to-end without
// flipping views/latest.json (nothing reads the throwaway version). Run from web/:
//   bun run scripts/verify-recompute-live.ts
/* eslint-disable no-console */
import { loadCanonicalModel, writeVersion } from "../lib/workflows/recompute/io";
import { computeAllViews } from "../lib/workflows/recompute";
import { validateVersion } from "../lib/workflows/steps/validate";

if (!process.env.BLOB_BASE_URL || !process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Missing BLOB_BASE_URL / BLOB_READ_WRITE_TOKEN (expected in web/.env.local).");
  process.exit(1);
}

// pass an existing run id as argv[2] to re-validate it without rewriting all views.
const existing = process.argv[2];
if (existing) {
  const v = await validateVersion(existing);
  console.log(`validate ${existing}: ok=${v.ok} checked=${v.checked} failures=${v.failures.length ? v.failures.join("; ") : "none"}`);
  process.exit(v.ok ? 0 : 1);
}

const runId = `verify-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
console.log(`runId=${runId}  base=${process.env.BLOB_BASE_URL!.slice(0, 48)}…`);

const t0 = Date.now();
const { model, seamDate, foldedThrough } = await loadCanonicalModel(runId);
console.log(`loaded canonical from Blob in ${Date.now() - t0}ms: repos=${model.repos.size} orgs=${model.orgs.size} seam=${seamDate}`);

const { views, stats } = computeAllViews(model, { gen: new Date().toISOString(), seamDate, foldedThrough });
console.log(`computed ${views.size} views: anchorDrift repo=${stats.repoAnchorDrift} org=${stats.orgAnchorDrift}`);
const at = views.get("rank/all-time/repo/stock.json") as { items: Array<{ id: number; value: number }> };
console.log(`all-time #1: id=${at.items[0].id} stars=${at.items[0].value}`);

const tw = Date.now();
const n = await writeVersion(runId, views);
console.log(`wrote ${n} views to views/${runId}/ in ${((Date.now() - tw) / 1000).toFixed(1)}s`);

const v = await validateVersion(runId);
console.log(`validate: ok=${v.ok} checked=${v.checked} failures=${v.failures.length ? v.failures.join("; ") : "none"}`);
console.log(v.ok ? "\nLIVE GLUE OK (no pointer flipped)" : "\nVALIDATION FAILED");
process.exit(v.ok ? 0 : 1);
