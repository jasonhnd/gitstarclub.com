// Backfill step 7 — export canonical/v2 JSON shards from the bootstrap fact table.
// One-time bootstrap seed for the Vercel-only model: reads star_daily.parquet +
// repos.json (already extracted), computes per-repo monthly/weekly flow, recent
// daily tail, site-daily totals, and the frozen discount d (DuckDB), then writes
// bucketed canonical/v2/* shards (bucket = id % 32, matching
// web/lib/workflows/buckets.ts), stages them under an immutable bootstrap
// generation, validates both phases, and commits one pointer. After this, the
// Vercel workflow maintains copy-on-write canonical overlays — no DuckDB at runtime.
// See docs/DATA-CONTRACTS.md §1.4 / VERCEL-DATA-OPERATIONS §5.
// Run (from pipeline/):  node backfill/07-export-v2.mjs --generation bootstrap-YYYYMMDDTHHMMSSZ
//                        node backfill/07-export-v2.mjs --no-upload  (export + local validation only)
//                        node backfill/07-export-v2.mjs --rollback bootstrap-<id> --execute
//                        node backfill/07-export-v2.mjs --rollback legacy-flat --execute

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { buildCanonicalMeta } from "../lib/canonical-meta.mjs";
import { createBlobBootstrapStore } from "../lib/blob-bootstrap-store.mjs";
import { withBootstrapPublicationLease } from "../lib/bootstrap-lease.mjs";
import {
  buildBootstrapPhaseManifest,
  commitBootstrapGeneration,
  LEGACY_FLAT_TARGET,
  rollbackBootstrapGeneration,
  sha256Bytes,
  stageBootstrapPhase,
} from "../lib/bootstrap-publication.mjs";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env — rely on shell env
}

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const p = (rel) => `${dataDir}/${rel}`.replaceAll("\\", "/"); // DuckDB wants forward slashes
const SD = p("star_daily.parquet");
const OUT = p("v2"); // local mirror; files live under OUT/<blob-path>
const VIEWS = p("views");
const VALIDATE_VIEWS = fileURLToPath(new URL("../../web/scripts/validate-views.ts", import.meta.url));
const VALIDATE_CANONICAL = fileURLToPath(new URL("../../web/scripts/validate-bootstrap-canonical.ts", import.meta.url));
const args = process.argv.slice(2);
const generationIndex = args.indexOf("--generation");
const generation = generationIndex >= 0 ? args[generationIndex + 1] : undefined;
const generatedAtIndex = args.indexOf("--generated-at");
const generatedAtArg = generatedAtIndex >= 0 ? args[generatedAtIndex + 1] : undefined;
const noUpload = args.includes("--no-upload");
const stageOnly = args.includes("--stage-only");
const rollbackIndex = args.indexOf("--rollback");
const rollbackRequested = rollbackIndex >= 0;
const rollbackValue = rollbackRequested ? args[rollbackIndex + 1] : undefined;
const rollbackTarget =
  rollbackValue === LEGACY_FLAT_TARGET || rollbackValue?.startsWith("bootstrap-")
    ? rollbackValue
    : undefined;
const BUCKETS = 32;
const RECENT_DAYS = 90;
const SCHEMA_VER = 1;

function timestampFromGeneration(value) {
  const match = /^bootstrap-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z(?:-|$)/.exec(value ?? "");
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.000Z`;
}

const GEN = generatedAtArg ?? timestampFromGeneration(generation) ?? (noUpload ? new Date().toISOString() : null);
if (!rollbackRequested && (!GEN || !Number.isFinite(Date.parse(GEN)))) {
  throw new Error(
    "staged upload needs deterministic time: use generation bootstrap-YYYYMMDDTHHMMSSZ or pass --generated-at <ISO>",
  );
}
const num = (v) => (typeof v === "bigint" ? Number(v) : v);
const bucketOf = (id) => id % BUCKETS;

function runValidator(script, directory, label) {
  const result = spawnSync("bun", [script, directory], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} validation failed with exit ${result.status}`);
}

function walkFiles(directory) {
  const files = [];
  for (const name of readdirSync(directory).sort()) {
    const path = `${directory}/${name}`;
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

function localBaseItems() {
  const base = walkFiles(VIEWS).map((abs) => ({
    path: `views/${abs.slice(VIEWS.length + 1).replaceAll("\\", "/")}`,
    body: readFileSync(abs),
  }));
  try {
    if (statSync(SD).isFile()) base.push({ path: "canonical/star_daily.parquet", body: readFileSync(SD) });
  } catch {
    // Step 06 also treats the parquet archive as optional.
  }
  return base;
}

function assertLocalManifestMatches(generation, phase, localItems, remotePhase) {
  const local = buildBootstrapPhaseManifest(generation, phase, localItems);
  const digest = sha256Bytes(Buffer.from(JSON.stringify(local)));
  if (digest !== remotePhase.sha256) {
    throw new Error(`${phase} local validation input does not match sealed remote manifest`);
  }
}

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (rollbackRequested) {
  if (!args.includes("--execute")) throw new Error("bootstrap rollback requires --execute");
  if (!rollbackTarget) {
    throw new Error(
      "bootstrap rollback requires an explicit target: --rollback <bootstrap-id|legacy-flat> --execute",
    );
  }
  if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  const store = createBlobBootstrapStore(TOKEN);
  const result = await withBootstrapPublicationLease({
    store,
    generation: rollbackTarget,
    operation: "rollback",
    run: (assertCanCommit) =>
      rollbackBootstrapGeneration({
        store,
        targetGeneration: rollbackTarget,
        assertCanCommit,
      }),
  });
  const previous = result.pointer?.previous_generation ?? result.previousPointer?.generation ?? "none";
  console.log(
    `rollback ${result.status}: target=${result.target} previous=${previous} objects=${result.verified.objectCount} bytes=${result.verified.totalBytes}`,
  );
  process.exit(0);
}

if (!noUpload && !generation) {
  throw new Error("--generation bootstrap-YYYYMMDDTHHMMSSZ is required for staging, resume, and commit");
}

function addDays(ymd, days) {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

const madeDirs = new Set();
let fileCount = 0;
const writtenFiles = [];
function writeJson(rel, obj) {
  const full = `${OUT}/${rel}`;
  const dir = full.slice(0, full.lastIndexOf("/"));
  if (!madeDirs.has(dir)) {
    mkdirSync(dir, { recursive: true });
    madeDirs.add(dir);
  }
  writeFileSync(full, JSON.stringify(obj));
  writtenFiles.push(full);
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

const [{ hi: rawHi }] = await query(`SELECT CAST(MAX(date) AS VARCHAR) hi FROM read_parquet('${SD}')`);
const hi = String(rawHi);
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
writeJson(
  "canonical/v2/meta.json",
  buildCanonicalMeta({
    seamDate,
    schemaVer: SCHEMA_VER,
    foldedThroughMonth: hi.slice(0, 7),
    foldedThroughWeek: wk,
    generatedAt: GEN,
  }),
);

writeBucketSeries("canonical/v2/repo-monthly", bucketSeries(monthly, (r) => [r.period, num(r.flow)]));
writeBucketSeries("canonical/v2/repo-weekly", bucketSeries(weekly, (r) => [r.period, num(r.flow)]));
writeBucketSeries("canonical/v2/repo-recent-daily", bucketSeries(recent, (r) => [r.d, num(r.delta)]));

// site-daily per year
const byYear = new Map();
for (const r of site) {
  const day = String(r.d);
  const y = day.slice(0, 4);
  (byYear.get(y) ?? byYear.set(y, []).get(y)).push([day, num(r.tot)]);
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
    active: true,
    is_archived: !!r.is_archived,
    crossed_10k: r.crossed_10k ?? null,
    crossed_50k: r.crossed_50k ?? null,
    crossed_100k: r.crossed_100k ?? null,
    tracked_since: null,
    d: dById.get(r.id) ?? 1, // full-precision IEEE double (matches DuckDB) so stock_est reconstructs exactly
    fetched_at: r.fetched_at ?? GEN,
  };
}
for (let b = 0; b < BUCKETS; b++) writeJson(`canonical/v2/repos/${b}.json`, repoBuckets.get(b) ?? {});

console.log(`export: ${fileCount} files → ${OUT}/canonical/v2`);
console.log(`  seam_date=${seamDate} folded_through={month:${hi.slice(0, 7)}, week:${wk}} repos=${repos.length}`);
const vue = repos.find((r) => r.full_name === "vuejs/vue");
if (vue) console.log(`  sanity vuejs/vue: bucket=${bucketOf(vue.id)} d=${dById.get(vue.id)?.toFixed(4)} stars=${vue.current_stars}`);

// --- validate, immutably stage, then atomically commit bootstrap/latest.json ---
runValidator(VALIDATE_CANONICAL, `${OUT}/canonical/v2`, "canonical");
if (noUpload) {
  console.log("--no-upload: local canonical validation passed; skipped Blob staging and commit");
  process.exit(0);
}
if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set — add to pipeline/.env or use --no-upload");

const MAX_PER_SEC = 60;
const CONCURRENCY = 12;
const RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nextStart = 0;
async function gate() {
  const now = Date.now();
  const wait = Math.max(0, nextStart - now);
  nextStart = Math.max(now, nextStart) + 1000 / MAX_PER_SEC;
  if (wait > 0) await sleep(wait);
}

function withUploadRetry(store) {
  return {
    read: (path) => store.read(path),
    put: (path, body, contentType) => store.put(path, body, contentType),
    async create(path, body, contentType) {
      for (let attempt = 1; ; attempt++) {
        await gate();
        try {
          return await store.create(path, body, contentType);
        } catch (error) {
          if (attempt > RETRIES) throw error;
          await sleep(500 * 2 ** (attempt - 1));
        }
      }
    },
  };
}

const items = writtenFiles.map((abs) => ({
  path: abs.slice(OUT.length + 1).replaceAll("\\", "/"),
  body: readFileSync(abs),
  contentType: "application/json",
}));
const blobStore = createBlobBootstrapStore(TOKEN);
const store = withUploadRetry(blobStore);
const staged = await stageBootstrapPhase({
  generation,
  phase: "canonical",
  items,
  store,
  concurrency: CONCURRENCY,
  onProgress: ({ completed, total }) => {
    if (completed % 50 === 0 || completed === total) console.log(`  staged/verified ${completed}/${total}`);
  },
});
console.log(
  `canonical ${staged.status}: objects=${staged.manifest.object_count} bytes=${staged.manifest.total_bytes} created=${staged.created} reused=${staged.reused}`,
);
if (stageOnly) {
  console.log("--stage-only: production pointer unchanged");
  process.exit(0);
}

const committed = await withBootstrapPublicationLease({
  store: blobStore,
  generation,
  operation: "publish",
  run: (assertCanCommit) =>
    commitBootstrapGeneration({
      generation,
      store,
      validate: async (verified) => {
        assertLocalManifestMatches(generation, "base", localBaseItems(), verified.base);
        assertLocalManifestMatches(generation, "canonical", items, verified.canonical);
        runValidator(VALIDATE_VIEWS, VIEWS, "views");
        runValidator(VALIDATE_CANONICAL, `${OUT}/canonical/v2`, "canonical");
      },
      assertCanCommit,
    }),
});
console.log(
  `${committed.status}: generation=${committed.pointer.generation} previous=${committed.pointer.previous_generation} objects=${committed.verified.objectCount} bytes=${committed.verified.totalBytes}`,
);
console.log("commit point: bootstrap/latest.json (single atomic pointer write)");
