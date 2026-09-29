import { createBlobBootstrapStore } from "./blob-bootstrap-store.mjs";
import { createR2BootstrapStore } from "./r2-bootstrap-store.mjs";

export const UPLOAD_HELP = `Backfill step 6 — stage an immutable base phase. This step does not publish a pointer.

Blob (unchanged: upload unless --dry-run):
  node backfill/06-upload.mjs --generation bootstrap-20260717T120000Z --dry-run
  node backfill/06-upload.mjs --generation bootstrap-20260717T120000Z

R2 (dry-run unless --execute):
  node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z
  node backfill/06-upload.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z --execute
  node backfill/06-upload.mjs --store r2 --target prod --generation bootstrap-20260717T120000Z --execute

Flags:
  --generation <bootstrap-id>   Required.
  --store blob|r2               Default blob.
  --target prod|pre             Required with --store r2. Refused unless --store r2.
  --execute                     Required for R2 writes. Without it, R2 prints the plan and writes nothing.
  --dry-run                     Validate and print the plan. No remote writes.
  -h, --help                    Show this help.

The owner places R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in pipeline/.env.
Endpoint: R2_S3_ENDPOINT, or https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com.
Bucket: R2_BUCKET_PRE / R2_BUCKET_PROD, or R2_BUCKET when the name matches --target.
Writes read _meta/bucket-identity.json and refuse a missing or mismatched marker
(prod expects deploy_env production; pre expects deploy_env pre). This command never writes _meta/.
`;

export const EXPORT_HELP = `Backfill step 7 — export canonical/v2, stage it, and commit one bootstrap pointer.

Blob (unchanged):
  node backfill/07-export-v2.mjs --generation bootstrap-20260717T120000Z --no-upload
  node backfill/07-export-v2.mjs --generation bootstrap-20260717T120000Z --stage-only
  node backfill/07-export-v2.mjs --generation bootstrap-20260717T120000Z
  node backfill/07-export-v2.mjs --rollback bootstrap-20260710T120000Z --execute
  node backfill/07-export-v2.mjs --rollback legacy-flat --execute

R2 dry-run (no remote writes):
  node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z

R2 stage, then the empty-bucket first commit (previous_generation null):
  node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z --execute --stage-only
  node backfill/07-export-v2.mjs --store r2 --target pre --generation bootstrap-20260717T120000Z --execute --initial-commit

R2 later rollback (a generation that was published; legacy-flat still requires the flat layout):
  node backfill/07-export-v2.mjs --store r2 --target pre --rollback bootstrap-20260717T120000Z --execute
  node backfill/07-export-v2.mjs --store r2 --target prod --generation bootstrap-20260717T120000Z --execute --initial-commit

Flags:
  --generation <bootstrap-id>   Required to stage or commit. Use bootstrap-YYYYMMDDTHHMMSSZ or pass --generated-at.
  --generated-at <ISO>          Deterministic canonical meta timestamp.
  --store blob|r2               Default blob.
  --target prod|pre             Required with --store r2. Refused unless --store r2.
  --execute                     Required for every R2 write, including --stage-only and --rollback.
  --initial-commit              R2 only. First pointer when the bucket has no bootstrap/latest.json,
                                no views/latest.json, and no canonical/v2/meta.json. Refuses mixed state.
  --stage-only                  Stage the canonical phase and do not commit the pointer.
  --no-upload                   Export and validate locally. No remote writes.
  --dry-run                     Same remote effect as omitting --execute on R2: no remote writes.
  --rollback <bootstrap-id|legacy-flat>
                                Requires --execute. Blob behavior is unchanged.
  -h, --help                    Show this help.

Credentials, bucket selection, and the bucket-identity marker match step 6.
--initial-commit is not a legacy-flat rollback target. Blob without --initial-commit
still proves the legacy flat layout before the first pointer.
`;

function needValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseBootstrapArgs(argv) {
  const cli = {
    help: false,
    store: "blob",
    target: null,
    execute: false,
    dryRun: false,
    noUpload: false,
    stageOnly: false,
    initialCommit: false,
    generation: undefined,
    generatedAt: undefined,
    rollback: undefined,
    rollbackRequested: false,
  };
  /** @type {string[]} */
  const unknown = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") cli.help = true;
    else if (arg === "--execute") cli.execute = true;
    else if (arg === "--dry-run") cli.dryRun = true;
    else if (arg === "--no-upload") cli.noUpload = true;
    else if (arg === "--stage-only") cli.stageOnly = true;
    else if (arg === "--initial-commit") cli.initialCommit = true;
    else if (arg === "--store") cli.store = needValue(argv, ++index, "--store");
    else if (arg.startsWith("--store=")) cli.store = arg.slice("--store=".length);
    else if (arg === "--target") cli.target = needValue(argv, ++index, "--target");
    else if (arg.startsWith("--target=")) cli.target = arg.slice("--target=".length);
    else if (arg === "--generation") cli.generation = needValue(argv, ++index, "--generation");
    else if (arg.startsWith("--generation=")) cli.generation = arg.slice("--generation=".length);
    else if (arg === "--generated-at") cli.generatedAt = needValue(argv, ++index, "--generated-at");
    else if (arg.startsWith("--generated-at=")) cli.generatedAt = arg.slice("--generated-at=".length);
    else if (arg === "--rollback") {
      cli.rollbackRequested = true;
      cli.rollback = needValue(argv, ++index, "--rollback");
    } else if (arg.startsWith("--rollback=")) {
      cli.rollbackRequested = true;
      cli.rollback = arg.slice("--rollback=".length);
    } else unknown.push(arg);
  }
  if (cli.help) return cli;
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}`);
  if (cli.store !== "blob" && cli.store !== "r2") throw new Error("--store must be blob or r2");
  if (cli.target !== null && cli.store !== "r2") throw new Error("--target requires --store r2");
  if (cli.target !== null && cli.target !== "prod" && cli.target !== "pre") {
    throw new Error("--target must be prod or pre");
  }
  if (cli.store === "r2" && cli.target !== "prod" && cli.target !== "pre") {
    throw new Error("--store r2 requires --target prod|pre");
  }
  if (cli.initialCommit && cli.store !== "r2") throw new Error("--initial-commit requires --store r2");
  if (cli.initialCommit && cli.stageOnly) throw new Error("--initial-commit cannot be combined with --stage-only");
  if (cli.rollbackRequested && cli.initialCommit) {
    throw new Error("--initial-commit cannot be combined with --rollback");
  }
  if (cli.rollbackRequested && (cli.dryRun || cli.noUpload)) {
    throw new Error("--rollback cannot be combined with --dry-run or --no-upload");
  }
  return cli;
}

export function remoteWriteEnabled(cli) {
  if (cli.dryRun || cli.noUpload) return false;
  if (cli.store === "r2" && !cli.execute) return false;
  return true;
}

export function bucketMatchesTarget(bucket, target) {
  const name = bucket.toLowerCase();
  if (target === "prod") return name.endsWith("-prod") || name.endsWith("_prod");
  const pre = name.endsWith("-pre") || name.endsWith("_pre");
  return pre && !name.endsWith("-prod") && !name.endsWith("_prod");
}

export function resolveR2BucketName(env, target) {
  if (target !== "prod" && target !== "pre") throw new Error("--target must be prod or pre");
  const named = (target === "prod" ? env.R2_BUCKET_PROD : env.R2_BUCKET_PRE)?.trim();
  const single = (env.R2_BUCKET || env.AWS_S3_BUCKET || "").trim();
  if (named && single && named !== single) {
    throw new Error(
      `R2_BUCKET does not match R2_BUCKET_${target === "prod" ? "PROD" : "PRE"} for --target ${target}`,
    );
  }
  const bucket = named || single;
  if (!bucket) {
    throw new Error(
      `R2 bucket for --target ${target} is unset; set R2_BUCKET_${target === "prod" ? "PROD" : "PRE"} or R2_BUCKET`,
    );
  }
  if (!named && !bucketMatchesTarget(bucket, target)) {
    throw new Error(`R2_BUCKET does not match --target ${target}`);
  }
  return bucket;
}

export function resolveR2Location(env, target) {
  const bucket = resolveR2BucketName(env, target);
  const explicit = (env.R2_S3_ENDPOINT || env.AWS_ENDPOINT_URL || "").replace(/\/+$/, "");
  const endpoint = explicit || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "");
  if (!endpoint) throw new Error("R2 endpoint is unset; set R2_S3_ENDPOINT or R2_ACCOUNT_ID");
  const accessKeyId = env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId) throw new Error("R2_ACCESS_KEY_ID is unset");
  if (!secretAccessKey) throw new Error("R2_SECRET_ACCESS_KEY is unset");
  const region = (env.R2_REGION || env.AWS_REGION || "auto").trim() || "auto";
  return { bucket, endpoint, accessKeyId, secretAccessKey, region, target };
}

export function formatRemotePlan({ objects, bytes, cli, bucket }) {
  const target = cli.store === "r2" ? cli.target : "blob";
  return `plan: store=${cli.store} target=${target} bucket=${bucket} objects=${objects} bytes=${bytes} writes=0`;
}

export function createStoreFromCli(cli, env, options = {}) {
  if (!remoteWriteEnabled(cli) && !options.force) {
    throw new Error("refusing to open a remote store when remote writes are disabled");
  }
  if (cli.store === "blob") return createBlobBootstrapStore(env.BLOB_READ_WRITE_TOKEN);
  const location = resolveR2Location(env, cli.target);
  return createR2BootstrapStore({
    ...location,
    fetch: options.fetch,
    now: options.now,
  });
}

export async function runRemoteStage({ cli, env, fetch, now, stage }) {
  if (!remoteWriteEnabled(cli)) return { action: "dry-run" };
  const store = createStoreFromCli(cli, env, { fetch, now });
  const result = await stage(store);
  return { action: "wrote", result };
}
