// Live-glue verification: load the canonical model, recompute the full view
// matrix, and (only with --execute) write it to a throwaway versioned prefix
// views/<verify-run>/**. The script does not flip views/latest.json.
// Dry-run is the default. Blob is the default store. R2 requires --target.
//
//   bun run scripts/verify-recompute-live.ts
//   bun run scripts/verify-recompute-live.ts --execute
//   bun run scripts/verify-recompute-live.ts --store r2 --target pre --execute
//   bun run scripts/verify-recompute-live.ts <existing-run-id>

import { fileURLToPath } from "node:url";
import { requireStorageWriteConfig } from "../lib/runtime-config";
import { loadCanonicalModel, writeVersion } from "../lib/workflows/recompute/io";
import { computeAllViews } from "../lib/workflows/recompute";
import { validateVersion } from "../lib/workflows/steps/validate";
import {
  applyOpsSelection,
  opsEnvKeys,
  publicReadBaseForOps,
  takeOpsFlags,
} from "../lib/storage/ops-target";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";

const HELP = `Recompute live views into a throwaway prefix. Dry-run unless --execute.

  bun run scripts/verify-recompute-live.ts
  bun run scripts/verify-recompute-live.ts --execute
  bun run scripts/verify-recompute-live.ts --store r2 --target pre
  bun run scripts/verify-recompute-live.ts <existing-run-id>

An existing run id only re-validates. It does not write.
--store blob is the default and refuses --target. --store r2 requires --target prod|pre.
`;

const webDir = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const { selection, rest } = takeOpsFlags(argv);
const dry = rest.includes("--dry") || rest.includes("--dry-run");
const execute = rest.includes("--execute");
const positional = rest.filter((arg) => arg !== "--execute" && arg !== "--dry" && arg !== "--dry-run");
if (positional.length > 1) {
  console.error(HELP);
  process.exit(1);
}
const existing = positional[0];
const writing = execute && !dry && !existing;

loadWebEnvFiles(webDir, {
  keys: opsEnvKeys(selection, writing),
  onDiagnostic: warnEnvFileDiagnostic,
});
applyOpsSelection(process.env, selection);

let base: string;
try {
  base = publicReadBaseForOps(process.env, selection);
  if (writing) requireStorageWriteConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (existing) {
  const v = await validateVersion(existing);
  console.log(
    `validate ${existing}: ok=${v.ok} checked=${v.checked} failures=${v.failures.length ? v.failures.join("; ") : "none"}`,
  );
  process.exit(v.ok ? 0 : 1);
}

const runId = `verify-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
console.log(`runId=${runId}  base=${base.slice(0, 48)}…`);

const t0 = Date.now();
const { model, seamDate, foldedThrough } = await loadCanonicalModel(runId);
console.log(
  `loaded canonical in ${Date.now() - t0}ms: repos=${model.repos.size} orgs=${model.orgs.size} seam=${seamDate}`,
);

const { views, stats } = computeAllViews(model, { gen: new Date().toISOString(), seamDate, foldedThrough });
console.log(`computed ${views.size} views: anchorDrift repo=${stats.repoAnchorDrift} org=${stats.orgAnchorDrift}`);
const at = views.get("rank/all-time/repo/stock.json") as { items: Array<{ id: number; value: number }> };
console.log(`all-time #1: id=${at.items[0].id} stars=${at.items[0].value}`);

if (!writing) {
  console.log(`dry-run: computed ${views.size} views; pass --execute to write views/${runId}/`);
  process.exit(0);
}

const tw = Date.now();
const n = await writeVersion(runId, views);
console.log(`wrote ${n} views to views/${runId}/ in ${((Date.now() - tw) / 1000).toFixed(1)}s`);

const v = await validateVersion(runId);
console.log(`validate: ok=${v.ok} checked=${v.checked} failures=${v.failures.length ? v.failures.join("; ") : "none"}`);
console.log(v.ok ? "\nLIVE GLUE OK (no pointer flipped)" : "\nVALIDATION FAILED");
process.exit(v.ok ? 0 : 1);
