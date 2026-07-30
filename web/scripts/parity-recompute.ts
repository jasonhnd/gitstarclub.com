// Offline parity harness (Phase 4 gate): recompute every view from local canonical/v2
// shards and structurally diff against the DuckDB precompute output (pipeline/data/views).
// Proves the pure-JS recompute core is equivalent before any Blob/read-path change.
// Run from web/:  bun run scripts/parity-recompute.ts

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildModel, type RawShards } from "../lib/workflows/recompute/model";
import { computeAllViews } from "../lib/workflows/recompute";

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

// --- structural diff (ignores generated_at/backfilled_at, order-insensitive on object keys) ---
const IGNORE = new Set(["generated_at", "backfilled_at"]);
interface Leaf { path: string; a: unknown; b: unknown; numeric: boolean }
function diff(a: unknown, b: unknown, path: string, out: Leaf[]): void {
  if (a === b) return;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) { out.push({ path, a, b, numeric: false }); return; }
  if (ta === "array") {
    const aa = a as unknown[], bb = b as unknown[];
    if (aa.length !== bb.length) { out.push({ path: `${path}.length`, a: aa.length, b: bb.length, numeric: false }); return; }
    for (let i = 0; i < aa.length; i++) diff(aa[i], bb[i], `${path}[${i}]`, out);
  } else if (ta === "object") {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)].filter((k) => !IGNORE.has(k)));
    for (const k of keys) {
      if (!(k in ao) || !(k in bo)) { out.push({ path: `${path}.${k}`, a: ao[k], b: bo[k], numeric: false }); continue; }
      diff(ao[k], bo[k], `${path}.${k}`, out);
    }
  } else {
    out.push({ path, a, b, numeric: ta === "number" });
  }
}

// meta.json: compare only seam_date + schema_ver (folded_through + timestamps are Phase-4 additions).
function compareView(rel: string, produced: unknown, disk: unknown): Leaf[] {
  if (rel === "meta.json") {
    const p = produced as Record<string, unknown>, d = disk as Record<string, unknown>;
    const out: Leaf[] = [];
    diff(p.seam_date, d.seam_date, "seam_date", out);
    diff(p.schema_ver, d.schema_ver, "schema_ver", out);
    return out;
  }
  // newcomers tie-break: precompute keeps repos.json insertion order for equal current_stars;
  // recompute uses deterministic (value desc, id asc). Canonicalize both, then compare.
  if (rel.endsWith("/repo/new.json")) {
    const norm = (v: unknown) => {
      const o = { ...(v as { items: Array<{ value: number; id: number }> }) };
      o.items = [...o.items].sort((a, b) => b.value - a.value || a.id - b.id).map((it, i) => ({ ...it, rank: i + 1 }));
      return o;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  // members[] order is intentionally id-ascending now (deterministic); the old run used
  // repos.json insertion order. Compare as a set.
  if (rel.startsWith("entity/org/")) {
    const norm = (v: unknown) => {
      const o = { ...(v as Record<string, unknown>) };
      if (Array.isArray(o.members)) o.members = [...o.members].sort((a, b) => Number(a) - Number(b));
      return o;
    };
    produced = norm(produced);
    disk = norm(disk);
  }
  const out: Leaf[] = [];
  diff(produced, disk, "", out);
  return out;
}

let exact = 0, rounding = 0, mismatch = 0, missingOnDisk = 0;
let maxDelta = 0;
let maxDeltaWhere = "";
const mismatchSamples: string[] = [];
const roundingSamples: string[] = [];

for (const [rel, produced] of views) {
  const path = `${VIEWS}/${rel}`;
  if (!existsSync(path)) { missingOnDisk++; if (missingOnDisk <= 5) mismatchSamples.push(`MISSING ON DISK: ${rel}`); continue; }
  const leaves = compareView(rel, produced, J(path));
  if (leaves.length === 0) { exact++; continue; }
  const allNumericTiny = leaves.every((l) => l.numeric && Math.abs(Number(l.a) - Number(l.b)) <= 1);
  for (const l of leaves) {
    if (!l.numeric) continue;
    const d = Math.abs(Number(l.a) - Number(l.b));
    if (d > maxDelta) { maxDelta = d; maxDeltaWhere = `${rel}${l.path}: ${l.a} vs ${l.b}`; }
  }
  if (allNumericTiny) {
    rounding++;
    if (roundingSamples.length < 6) roundingSamples.push(`${rel}  Δ@${leaves[0].path}: ${leaves[0].a} vs ${leaves[0].b} (${leaves.length} leaves)`);
  } else {
    mismatch++;
    if (mismatchSamples.length < 12)
      mismatchSamples.push(`${rel}  [${leaves.length} diffs] e.g. ${leaves[0].path}: ${JSON.stringify(leaves[0].a)} vs ${JSON.stringify(leaves[0].b)}`);
  }
}

// coverage: disk view files that recompute did NOT produce (excluding live-cron artifacts).
const LIVE_ARTIFACTS = new Set(["hot-snapshot.json", "current_month.json"]);
function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) out.push(...walk(`${dir}/${name.name}`, rel));
    else out.push(rel);
  }
  return out;
}
const onDisk = walk(VIEWS).filter((f) => !LIVE_ARTIFACTS.has(f));
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

const ok = mismatch === 0 && missingOnDisk === 0 && notProduced.length === 0 && maxDelta <= 1;
console.log(`\n${ok ? "PARITY OK" : "PARITY FAIL"} (maxΔ=${maxDelta})`);
process.exit(ok ? 0 : 1);
