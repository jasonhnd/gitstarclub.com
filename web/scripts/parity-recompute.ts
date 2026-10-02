// Offline parity harness (Phase 4 gate): recompute every view from local canonical/v2
// shards and structurally diff against the DuckDB precompute output (pipeline/data/views).
// Proves the pure-JS recompute core is equivalent before any Blob/read-path change.
// Run from web/:  bun run scripts/parity-recompute.ts

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildModel, type RawShards } from "../lib/workflows/recompute/model";
import { computeAllViews } from "../lib/workflows/recompute";
import {
  classifyParityLeaves,
  compareParityView,
  excludeParityLiveArtifacts,
  parityIsOk,
  walkParityFiles,
} from "./lib/parity-diff";

const root = fileURLToPath(new URL("../../pipeline/data", import.meta.url));
const CANON = `${root}/v2/canonical/v2`;
const VIEWS = `${root}/views`;
const BUCKETS = 32;
const J = (f: string) => JSON.parse(readFileSync(f, "utf8"));

function mergeBuckets<T>(sub: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (let b = 0; b < BUCKETS; b++) Object.assign(out, J(`${CANON}/${sub}/${b}.json`));
  return out;
}

const siteDailyByYear: RawShards["siteDailyByYear"] = {};
for (const f of readdirSync(`${CANON}/site-daily`)) {
  const o = J(`${CANON}/site-daily/${f}`);
  siteDailyByYear[o.year] = o;
}
const canonMeta = J(`${CANON}/meta.json`);

const raw: RawShards = {
  repos: mergeBuckets("repos"),
  monthly: mergeBuckets("repo-monthly"),
  weekly: mergeBuckets("repo-weekly"),
  recentDaily: mergeBuckets("repo-recent-daily"),
  siteDailyByYear,
};

const model = buildModel(raw, canonMeta.seam_date);
const t0 = Date.now();
const { views, stats } = computeAllViews(model, {
  gen: "PARITY",
  seamDate: canonMeta.seam_date,
  foldedThrough: canonMeta.folded_through,
});
const elapsed = Date.now() - t0;

let exact = 0, rounding = 0, mismatch = 0, missingOnDisk = 0;
let maxDelta = 0;
let maxDeltaWhere = "";
const mismatchSamples: string[] = [];
const roundingSamples: string[] = [];

for (const [rel, produced] of views) {
  const path = `${VIEWS}/${rel}`;
  if (!existsSync(path)) { missingOnDisk++; if (missingOnDisk <= 5) mismatchSamples.push(`MISSING ON DISK: ${rel}`); continue; }
  const leaves = compareParityView(rel, produced, J(path));
  const classified = classifyParityLeaves(rel, leaves);
  if (classified.kind === "exact") { exact++; continue; }
  if (classified.maxDelta > maxDelta) {
    maxDelta = classified.maxDelta;
    maxDeltaWhere = classified.maxDeltaWhere;
  }
  if (classified.kind === "rounding") {
    rounding++;
    if (roundingSamples.length < 6) roundingSamples.push(classified.sample);
  } else {
    mismatch++;
    if (mismatchSamples.length < 12) mismatchSamples.push(classified.sample);
  }
}

// coverage: disk view files that recompute did NOT produce (excluding live-cron artifacts).
const onDisk = excludeParityLiveArtifacts(walkParityFiles(VIEWS));
const producedSet = new Set(views.keys());
const notProduced = onDisk.filter((f) => !producedSet.has(f));

console.log(`\nrecompute: ${views.size} views in ${elapsed}ms`);
console.log(`  stats: repos=${stats.repos} orgs=${stats.orgs} anchorDrift repo=${stats.repoAnchorDrift} org=${stats.orgAnchorDrift}`);
console.log(`\nparity vs ${onDisk.length} disk views (excl. live artifacts):`);
console.log(`  exact            : ${exact}`);
console.log(`  match within ±1  : ${rounding}   (frozen 6dp-d rounding)`);
console.log(`  MISMATCH         : ${mismatch}`);
console.log(`  missing on disk  : ${missingOnDisk}`);
console.log(`  not produced     : ${notProduced.length}`);
console.log(`  max numeric Δ    : ${maxDelta}  @ ${maxDeltaWhere}`);
if (roundingSamples.length) console.log(`\n  ±1 samples:\n    ${roundingSamples.join("\n    ")}`);
if (mismatchSamples.length) console.log(`\n  MISMATCH samples:\n    ${mismatchSamples.join("\n    ")}`);
if (notProduced.length) console.log(`\n  not-produced samples:\n    ${notProduced.slice(0, 12).join("\n    ")}`);

const ok = parityIsOk({ mismatch, missingOnDisk, notProduced: notProduced.length, maxDelta });
console.log(`\n${ok ? "PARITY OK" : "PARITY FAIL"} (maxΔ=${maxDelta})`);
process.exit(ok ? 0 : 1);
