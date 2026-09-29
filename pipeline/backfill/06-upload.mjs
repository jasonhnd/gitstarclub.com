// Backfill step 6 — validate and stage the complete base-view phase under an
// immutable bootstrap generation. This step NEVER updates a production path or
// pointer. Step 07 stages canonical shards, validates both phases, and performs
// the one-file bootstrap/latest.json commit.
//
// Blob (upload unless --dry-run):
//   node backfill/06-upload.mjs --generation bootstrap-20260717T120000Z --dry-run
//   node backfill/06-upload.mjs --generation bootstrap-20260717T120000Z
// R2 (dry-run unless --execute):
//   node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z
//   node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z --execute
//   node backfill/06-upload.mjs --help

import { readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  UPLOAD_HELP,
  formatRemotePlan,
  parseBootstrapArgs,
  preflightR2Identity,
  remoteWriteEnabled,
  resolveR2BucketName,
  runRemoteStage,
} from "../lib/bootstrap-cli.mjs";
import {
  bootstrapGenerationPrefix,
  stageBootstrapPhase,
} from "../lib/bootstrap-publication.mjs";
import { withUploadRetry } from "../lib/upload-retry.mjs";

const cli = parseBootstrapArgs(process.argv.slice(2));
if (cli.help) {
  console.log(UPLOAD_HELP);
  process.exit(0);
}

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // no .env — rely on inline / shell env
}

const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const VIEWS = `${dataDir}/views`;
const PARQUET = `${dataDir}/star_daily.parquet`;
const VALIDATE_VIEWS = fileURLToPath(new URL("../../web/scripts/validate-views.ts", import.meta.url));
const generation = cli.generation;
const writing = remoteWriteEnabled(cli);

if (!generation) throw new Error("--generation bootstrap-<specific-id> is required for preview, staging, and resume");
const generationPrefix = bootstrapGenerationPrefix(generation);
if (writing && cli.store === "blob" && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error("BLOB_READ_WRITE_TOKEN not set — add it to pipeline/.env or use --dry-run");
}

const CONCURRENCY = 16;
const CONTENT_TYPE = { json: "application/json", parquet: "application/vnd.apache.parquet" };
const ctOf = (path) => CONTENT_TYPE[path.slice(path.lastIndexOf(".") + 1)] ?? "application/octet-stream";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function validateViews() {
  const result = spawnSync("bun", [VALIDATE_VIEWS, VIEWS], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`view validation failed with exit ${result.status}`);
}

try {
  statSync(VIEWS);
} catch {
  throw new Error(`${VIEWS} not found — run 05-precompute first`);
}

const items = walk(VIEWS).map((abs) => {
  const rel = abs.slice(VIEWS.length + 1).replaceAll("\\", "/");
  return { path: `views/${rel}`, body: readFileSync(abs), contentType: ctOf(rel) };
});
try {
  if (statSync(PARQUET).isFile()) {
    items.push({
      path: "canonical/star_daily.parquet",
      body: readFileSync(PARQUET),
      contentType: "application/vnd.apache.parquet",
    });
  }
} catch {
  console.warn("note: data/star_daily.parquet missing — bootstrap phase will not contain it");
}

const totalBytes = items.reduce((sum, item) => sum + item.body.byteLength, 0);
console.log(`bootstrap base: generation=${generation} objects=${items.length} bytes=${totalBytes}`);
console.log(`staging prefix: ${generationPrefix}/ (immutable; production pointer unchanged)`);
validateViews();

if (!writing) {
  const bucket = cli.store === "r2" ? resolveR2BucketName(process.env, cli.target) : "vercel-blob";
  console.log(formatRemotePlan({ objects: items.length, bytes: totalBytes, cli, bucket }));
  for (const item of items.slice(0, 8)) console.log(`  ${item.path} (${item.body.byteLength} bytes)`);
  await preflightR2Identity(cli, process.env);
  const outcome = await runRemoteStage({
    cli,
    env: process.env,
    stage: async () => {
      throw new Error("dry-run must not stage");
    },
  });
  if (outcome.action !== "dry-run") throw new Error("dry-run opened a remote write");
  console.log("dry-run: validation passed; nothing uploaded and no pointer changed");
  process.exit(0);
}

const outcome = await runRemoteStage({
  cli,
  env: process.env,
  stage: (store) =>
    stageBootstrapPhase({
      generation,
      phase: "base",
      items,
      store: withUploadRetry(store),
      concurrency: CONCURRENCY,
      onProgress: ({ completed, total }) => {
        if (completed % 500 === 0 || completed === total) console.log(`  staged/verified ${completed}/${total}`);
      },
    }),
});
const result = outcome.result;
console.log(
  `base ${result.status}: objects=${result.manifest.object_count} bytes=${result.manifest.total_bytes} created=${result.created} reused=${result.reused}`,
);
console.log(`next: run 07-export-v2.mjs with --generation ${generation} to validate and commit`);
