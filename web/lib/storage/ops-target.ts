/**
 * CLI target selection for operator scripts.
 * Bucket suffix rules stay aligned with pipeline/lib/bootstrap-cli.mjs.
 */

export type OpsEnv = Record<string, string | undefined>;
export type OpsStore = "blob" | "r2";
export type OpsTarget = "prod" | "pre";

export type OpsSelection = {
  store: OpsStore;
  target: OpsTarget | null;
};

function needValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function takeOpsFlags(argv: readonly string[]): { selection: OpsSelection; rest: string[] } {
  let store = "blob";
  let target: string | null = null;
  const rest: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--store") store = needValue(argv, ++index, "--store");
    else if (arg.startsWith("--store=")) store = arg.slice("--store=".length);
    else if (arg === "--target") target = needValue(argv, ++index, "--target");
    else if (arg.startsWith("--target=")) target = arg.slice("--target=".length);
    else rest.push(arg);
  }
  if (store !== "blob" && store !== "r2") throw new Error("--store must be blob or r2");
  if (target !== null && store !== "r2") throw new Error("--target requires --store r2");
  if (target !== null && target !== "prod" && target !== "pre") throw new Error("--target must be prod or pre");
  if (store === "r2" && target !== "prod" && target !== "pre") {
    throw new Error("--store r2 requires --target prod|pre");
  }
  return {
    selection: { store, target: target === "prod" || target === "pre" ? target : null },
    rest,
  };
}

export function deployEnvForTarget(target: OpsTarget): "production" | "pre" {
  return target === "prod" ? "production" : "pre";
}

export function bucketMatchesTarget(bucket: string, target: OpsTarget): boolean {
  const name = bucket.toLowerCase();
  if (target === "prod") return name.endsWith("-prod") || name.endsWith("_prod");
  const pre = name.endsWith("-pre") || name.endsWith("_pre");
  return pre && !name.endsWith("-prod") && !name.endsWith("_prod");
}

export function resolveOpsBucketName(env: OpsEnv, target: OpsTarget): string {
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

/** Point this process at blob or r2_s3 before any object-store call. */
export function applyOpsSelection(env: OpsEnv, selection: OpsSelection): void {
  if (selection.store === "blob") {
    env.STORAGE_READ_DRIVER = "blob";
    env.STORAGE_WRITE_DRIVER = "blob";
    return;
  }
  if (selection.target !== "prod" && selection.target !== "pre") {
    throw new Error("--store r2 requires --target prod|pre");
  }
  env.STORAGE_READ_DRIVER = "r2_s3";
  env.STORAGE_WRITE_DRIVER = "r2_s3";
  env.DEPLOY_ENV = deployEnvForTarget(selection.target);
  env.R2_BUCKET = resolveOpsBucketName(env, selection.target);
  env.R2_PREFIX = "";
}

export function publicReadBaseForOps(env: OpsEnv, selection: OpsSelection): string {
  if (selection.store === "r2") {
    if (selection.target !== "prod" && selection.target !== "pre") {
      throw new Error("--store r2 requires --target prod|pre");
    }
    const named = selection.target === "prod" ? env.R2_PUBLIC_BASE_URL_PROD : env.R2_PUBLIC_BASE_URL_PRE;
    const base = (named?.trim() || env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
    if (!base) throw new Error("R2_PUBLIC_BASE_URL not set");
    return base;
  }
  const base = (env.BLOB_BASE_URL ?? env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("BLOB_BASE_URL not set");
  return base;
}

/**
 * Blob returns the public base and does not fetch. R2 fetches the identity
 * marker from that base and refuses a missing marker or a bucket that does
 * not match `--target`, before the script plans a write. A passing check
 * copies the verified base onto `R2_PUBLIC_BASE_URL` so library reads use
 * the same origin the identity check just accepted.
 */
export async function assertPublicReadMatchesTarget(
  env: OpsEnv,
  selection: OpsSelection,
  fetchImpl: (input: string | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  const base = publicReadBaseForOps(env, selection);
  if (selection.store !== "r2" || (selection.target !== "prod" && selection.target !== "pre")) return base;
  const expectedBucket = resolveOpsBucketName(env, selection.target);
  const expectedEnv = deployEnvForTarget(selection.target);
  let response: Response;
  try {
    response = await fetchImpl(`${base}/_meta/bucket-identity.json`, { cache: "no-store" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`refusing R2 plan: public bucket identity is unreadable (${message})`);
  }
  if (!response.ok) {
    throw new Error(`refusing R2 plan: public bucket identity at ${base} is unreadable (${response.status})`);
  }
  let identity: unknown;
  try {
    identity = await response.json();
  } catch {
    throw new Error(`refusing R2 plan: public bucket identity at ${base} is unreadable (not JSON)`);
  }
  const record = identity && typeof identity === "object" ? (identity as { bucket?: unknown; deploy_env?: unknown }) : {};
  if (typeof record.bucket !== "string" || record.bucket !== expectedBucket) {
    const seen = typeof record.bucket === "string" ? record.bucket : "";
    throw new Error(`refusing R2 plan: public identity bucket "${seen}" does not match target "${expectedBucket}"`);
  }
  if (record.deploy_env !== expectedEnv) {
    throw new Error(
      `refusing R2 plan: public identity deploy_env=${String(record.deploy_env)} does not match --target ${selection.target} (expected ${expectedEnv})`,
    );
  }
  env.R2_PUBLIC_BASE_URL = base;
  return base;
}

export function opsEnvKeys(selection: OpsSelection, writing: boolean): string[] {
  if (selection.store === "blob") {
    const keys = ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"];
    if (writing) keys.push("BLOB_READ_WRITE_TOKEN");
    return keys;
  }
  const keys = [
    "R2_PUBLIC_BASE_URL",
    "R2_PUBLIC_BASE_URL_PRE",
    "R2_PUBLIC_BASE_URL_PROD",
    "R2_BUCKET",
    "R2_BUCKET_PRE",
    "R2_BUCKET_PROD",
    "AWS_S3_BUCKET",
    "R2_ACCOUNT_ID",
    "R2_S3_ENDPOINT",
    "AWS_ENDPOINT_URL",
    "R2_REGION",
    "AWS_REGION",
  ];
  if (writing) {
    keys.push("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  }
  return keys;
}

export function opsCredentialsPresent(env: OpsEnv, selection: OpsSelection): boolean {
  if (selection.store === "blob") return Boolean(env.BLOB_READ_WRITE_TOKEN);
  const access = env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
  const secret = env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
  const endpoint = env.R2_S3_ENDPOINT || env.AWS_ENDPOINT_URL || env.R2_ACCOUNT_ID;
  const bucket = env.R2_BUCKET || env.AWS_S3_BUCKET || env.R2_BUCKET_PROD || env.R2_BUCKET_PRE;
  return Boolean(access && secret && endpoint && bucket);
}

/** Names the env inventory must list. Tests pass their own object and do not print values. */
export function readOpsProcessEnv(): OpsEnv {
  return {
    R2_BUCKET_PROD: process.env.R2_BUCKET_PROD,
    R2_BUCKET_PRE: process.env.R2_BUCKET_PRE,
    R2_BUCKET: process.env.R2_BUCKET,
    AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
    R2_PUBLIC_BASE_URL_PROD: process.env.R2_PUBLIC_BASE_URL_PROD,
    R2_PUBLIC_BASE_URL_PRE: process.env.R2_PUBLIC_BASE_URL_PRE,
  };
}

export function splitConfirmArg(argv: readonly string[]): { confirm: string | undefined; positional: string[] } {
  const positional: string[] = [];
  let confirm: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--confirm") {
      confirm = needValue(argv, ++index, "--confirm");
    } else if (arg.startsWith("--confirm=")) {
      confirm = arg.slice("--confirm=".length);
    } else {
      positional.push(arg);
    }
  }
  return { confirm, positional };
}

export function firstPositional(argv: readonly string[]): string | undefined {
  return splitConfirmArg(argv).positional.find((arg) => !arg.startsWith("--"));
}
