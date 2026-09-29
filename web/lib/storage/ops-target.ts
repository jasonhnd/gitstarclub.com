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
    const base = (env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    if (!base) throw new Error("R2_PUBLIC_BASE_URL not set");
    return base;
  }
  const base = (env.BLOB_BASE_URL ?? env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("BLOB_BASE_URL not set");
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
