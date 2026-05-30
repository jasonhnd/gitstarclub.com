// Backfill step 6 — upload all precomputed views (+ canonical parquet) to Vercel Blob.
// Mirrors data/views/** to the Blob layout in docs/OPS.md (public store, stable paths, overwrite).
// Throttled to stay under the Blob write cap (75/s) and retries transient failures.
// Needs env BLOB_READ_WRITE_TOKEN (put it in pipeline/.env or pass inline). Prereq: step 05.
// Run (from pipeline/):  node backfill/06-upload.mjs        (real upload)
//                        node backfill/06-upload.mjs --dry-run   (preview, no token needed)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env — rely on inline / shell env
}

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const VIEWS = `${dataDir}/views`;
const PARQUET = `${dataDir}/star_daily.parquet`;

const DRY = process.argv.includes("--dry-run");
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!DRY && !TOKEN)
  throw new Error("BLOB_READ_WRITE_TOKEN not set — add it to pipeline/.env or pass inline (or use --dry-run to preview).");

const MAX_PER_SEC = 60; // OPS Blob write cap is 75/s; stay safely under
const CONCURRENCY = 16;
const RETRIES = 4;
const CACHE_MAX_AGE = 300; // overwritten paths must repropagate; cron views use ?v= cache-bust

const CONTENT_TYPE = { json: "application/json", parquet: "application/vnd.apache.parquet" };
const ctOf = (path) => CONTENT_TYPE[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream";
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

// rate gate: space out put() starts to ~MAX_PER_SEC regardless of concurrency
let nextStart = 0;
async function gate() {
  const now = Date.now();
  const wait = Math.max(0, nextStart - now);
  nextStart = Math.max(now, nextStart) + 1000 / MAX_PER_SEC;
  if (wait > 0) await sleep(wait);
}

async function uploadOne(item) {
  const body = readFileSync(item.abs);
  for (let attempt = 1; ; attempt++) {
    await gate();
    try {
      await put(item.rel, body, {
        access: "public",
        token: TOKEN,
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: ctOf(item.rel),
        cacheControlMaxAge: CACHE_MAX_AGE,
      });
      return body.length;
    } catch (err) {
      if (attempt > RETRIES) throw new Error(`put ${item.rel} failed after ${RETRIES} retries: ${err.message}`);
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

async function runPool(items) {
  let i = 0;
  let done = 0;
  let bytes = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      bytes += await uploadOne(item);
      if (++done % 500 === 0) console.log(`  uploaded ${done}/${items.length} (${(bytes / 1e6).toFixed(1)} MB)`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { done, bytes };
}

// --- build upload list: all views (paths relative to VIEWS) + canonical parquet ---
try {
  statSync(VIEWS);
} catch {
  throw new Error(`${VIEWS} not found — run 05-precompute first.`);
}
const items = walk(VIEWS).map((abs) => ({ abs, rel: abs.slice(VIEWS.length + 1).replaceAll("\\", "/") }));
try {
  if (statSync(PARQUET).isFile()) items.push({ abs: PARQUET, rel: "canonical/star_daily.parquet" });
} catch {
  console.warn("note: data/star_daily.parquet missing — skipping canonical upload.");
}

const totalBytes = items.reduce((s, it) => s + statSync(it.abs).size, 0);
console.log(`upload: ${items.length} objects, ${(totalBytes / 1e6).toFixed(1)} MB → Vercel Blob (public, ≤${MAX_PER_SEC}/s)`);

if (DRY) {
  const sample = items.filter((it) => /^(meta\.json|lookup|canonical|rank\/all-time|heatmap)/.test(it.rel)).slice(0, 8);
  for (const it of sample) console.log(`  e.g. ${it.rel}`);
  console.log("dry-run: nothing uploaded. Set BLOB_READ_WRITE_TOKEN and run without --dry-run.");
  process.exit(0);
}

const t0 = Date.now();
const { done, bytes } = await runPool(items);
console.log(`done: ${done} objects, ${(bytes / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(0);
