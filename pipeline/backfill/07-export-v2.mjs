// Backfill step 7 — export canonical/v2 JSON shards from the bootstrap fact table.
// One-time bootstrap seed for the Vercel-only model: reads star_daily.parquet +
// repos.json (already extracted), computes per-repo monthly/weekly flow, recent
// daily tail, site-daily totals, and the frozen discount d (DuckDB), then writes
// bucketed canonical/v2/* shards (bucket = id % 32, matching
// web/lib/workflows/buckets.ts) and uploads them to Vercel Blob. After this, the
// Vercel workflow maintains the shards incrementally — no DuckDB at runtime.
// See docs/DATA-CONTRACTS.md §1.4 / VERCEL-DATA-OPERATIONS §5.
// Run (from pipeline/):  node backfill/07-export-v2.mjs            (export + upload)
//                        node backfill/07-export-v2.mjs --no-upload  (export only)

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { put } from "@vercel/blob";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env — rely on shell env
}

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const p = (rel) => `${dataDir}/${rel}`.replaceAll("\\", "/"); // DuckDB wants forward slashes
const SD = p("star_daily.parquet");
const OUT = p("v2"); // local mirror; files live under OUT/<blob-path>
const BUCKETS = 32;
const RECENT_DAYS = 90;
const SCHEMA_VER = 1;
const GEN = new Date().toISOString();
const num = (v) => (typeof v === "bigint" ? Number(v) : v);
const bucketOf = (id) => id % BUCKETS;

function addDays(ymd, days) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const madeDirs = new Set();
let fileCount = 0;
function writeJson(rel, obj) {
  const full = `${OUT}/${rel}`;
  const dir = full.slice(0, full.lastIndexOf("/"));
  if (!madeDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    madeDirs.add(dir);
  }
  writeFileSync(full, JSON.stringify(obj));
  fileCount++;
}

/** Group `[repo_id,...]` rows into `{ bucket: { id: [valueFn(row), ...] } }`. */
function bucketSeries(rows, valueFn) {
  const buckets = new Map(); // bucket -> { id: array }
  for (const r of rows) {
    const id = num(r.repo_id);
    const b = bucketOf(id);
    let bm = buckets.get(b);
    if (!bm) buckets.set(b, (bm = {}));
    (bm[id] ??= []).push(valueFn(r));
  }
  return buckets;
}

function writeBucketSeries(prefix, buckets) {
  for (let b = 0; b < BUCKETS; b++) writeJson(`${prefix}/${b}.json`, buckets.get(b) ?? {});
}

// --- DuckDB ---
const db = await DuckDBInstance.create();
const con = await db.connect();
const query = async (sql) => (await con.runAndReadAll(sql)).getRowObjects();

const [{ hi }] = await query(`SELECT CAST(MAX(date) AS VARCHAR) hi FROM read_parquet('${SD}')`);
const seamDate = addDays(hi, 1); // first day the daily cron tracks as net
const recentCutoff = addDays(seamDate, -RECENT_DAYS);
const [{ wk }] = await query(`SELECT strftime(DATE '${hi}','%G-W%V') wk`);

// frozen discount d = current_stars / total_gross (anchors stock to current_stars; net never enters)
await con.run(
  `CREATE TABLE disc AS
   SELECT m.id repo_id,
          CASE WHEN COALESCE(g.tot,0) > 0 THEN m.current_stars::DOUBLE / g.tot ELSE 1 END d
   FROM read_json_auto('${p("repos.json")}', maximum_object_size=100000000, sample_size=-1) m
   LEFT JOIN (SELECT repo_id, SUM(delta) tot FROM read_parquet('${SD}') GROUP BY 1) g ON g.repo_id = m.id`,
);

const monthly = await query(`SELECT repo_id, strftime(date,'%Y-%m') period, SUM(delta) flow FROM read_parquet('${SD}') GROUP BY 1,2 ORDER BY 1,2`);
const weekly = await query(`SELECT repo_id, strftime(date,'%G-W%V') period, SUM(delta) flow FROM read_parquet('${SD}') GROUP BY 1,2 ORDER BY 1,2`);
const recent = await query(`SELECT repo_id, CAST(date AS VARCHAR) d, delta FROM read_parquet('${SD}') WHERE date >= DATE '${recentCutoff}' ORDER BY 1,2`);
const site = await query(`SELECT CAST(date AS VARCHAR) d, SUM(delta) tot FROM read_parquet('${SD}') GROUP BY 1 ORDER BY 1`);
const discRows = await query(`SELECT repo_id, d FROM disc`);
const dById = new Map(discRows.map((r) => [num(r.repo_id), num(r.d)]));

// --- write shards ---
writeJson("canonical/v2/meta.json", {
  seam_date: seamDate,
  schema_ver: SCHEMA_VER,
  folded_through: { month: hi.slice(0, 7), week: wk },
  generated_at: GEN,
});

writeBucketSeries("canonical/v2/repo-monthly", bucketSeries(monthly, (r) => [r.period, num(r.flow)]));
writeBucketSeries("canonical/v2/repo-weekly", bucketSeries(weekly, (r) => [r.period, num(r.flow)]));
writeBucketSeries("canonical/v2/repo-recent-daily", bucketSeries(recent, (r) => [r.d, num(r.delta)]));

// site-daily per year
const byYear = new Map();
for (const r of site) {
  const y = r.d.slice(0, 4);
  (byYear.get(y) ?? byYear.set(y, []).get(y)).push([r.d, num(r.tot)]);
}
for (const [year, cells] of byYear) writeJson(`canonical/v2/site-daily/${year}.json`, { year, cells });

// repos dimension shards (+ frozen d, tracked_since null for bootstrap baseline)
const repos = JSON.parse(readFileSync(p("repos.json"), "utf8"));
const repoBuckets = new Map();
for (const r of repos) {
  const b = bucketOf(r.id);
  let bm = repoBuckets.get(b);
  if (!bm) repoBuckets.set(b, (bm = {}));
  bm[r.id] = {
    id: r.id,
    node_id: r.node_id,
    owner: r.owner,
    owner_type: r.owner_type,
    name: r.name,
    full_name: r.full_name,
    description: r.description ?? null,
    language: r.language ?? null,
    topics: r.topics ?? [],
    created_at: r.created_at,
    current_stars: r.current_stars,
    is_archived: !!r.is_archived,
    crossed_10k: r.crossed_10k ?? null,
    crossed_50k: r.crossed_50k ?? null,
    crossed_100k: r.crossed_100k ?? null,
    tracked_since: null,
    d: Math.round((dById.get(r.id) ?? 1) * 1e6) / 1e6,
    fetched_at: r.fetched_at ?? GEN,
  };
}
for (let b = 0; b < BUCKETS; b++) writeJson(`canonical/v2/repos/${b}.json`, repoBuckets.get(b) ?? {});

console.log(`export: ${fileCount} files → ${OUT}/canonical/v2`);
console.log(`  seam_date=${seamDate} folded_through={month:${hi.slice(0, 7)}, week:${wk}} repos=${repos.length}`);
const vue = repos.find((r) => r.full_name === "vuejs/vue");
if (vue) console.log(`  sanity vuejs/vue: bucket=${bucketOf(vue.id)} d=${dById.get(vue.id)?.toFixed(4)} stars=${vue.current_stars}`);

// --- upload to Blob (throttled, like 06-upload) ---
if (process.argv.includes("--no-upload")) {
  console.log("--no-upload: skipped Blob upload.");
  process.exit(0);
}
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set — add to pipeline/.env or use --no-upload.");

const MAX_PER_SEC = 60;
const CONCURRENCY = 12;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
let nextStart = 0;
async function gate() {
  const now = Date.now();
  const wait = Math.max(0, nextStart - now);
  nextStart = Math.max(now, nextStart) + 1000 / MAX_PER_SEC;
  if (wait > 0) await sleep(wait);
}
const items = walk(OUT).map((abs) => ({ abs, rel: abs.slice(OUT.length + 1).replaceAll("\\", "/") }));
console.log(`upload: ${items.length} objects → Vercel Blob (≤${MAX_PER_SEC}/s)`);
let i = 0,
  done = 0;
async function worker() {
  while (i < items.length) {
    const item = items[i++];
    await gate();
    await put(item.rel, readFileSync(item.abs), {
      access: "public",
      token: TOKEN,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 300,
    });
    if (++done % 50 === 0) console.log(`  uploaded ${done}/${items.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done: uploaded ${done} objects to canonical/v2/`);
process.exit(0);
