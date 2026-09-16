// Runtime configuration boundary for server-side data and workflow modules.
// Keep process.env reads here so tests and route handlers can change config
// without relying on module reloads.

type RuntimeEnv = Record<string, string | undefined>;

export function getBlobBaseUrl(env: RuntimeEnv = process.env): string {
  return (env.BLOB_BASE_URL ?? env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
}

export function requireBlobBaseUrl(env?: RuntimeEnv): string {
  const value = getBlobBaseUrl(env);
  if (!value) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  return value;
}

export function getBlobWriteToken(env: RuntimeEnv = process.env): string | undefined {
  return env.BLOB_READ_WRITE_TOKEN || undefined;
}

export function requireBlobWriteToken(env?: RuntimeEnv): string {
  const value = getBlobWriteToken(env);
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return value;
}

export function getGithubToken(env: RuntimeEnv = process.env): string | undefined {
  return env.GITHUB_TOKEN || undefined;
}

export function requireGithubToken(env?: RuntimeEnv): string {
  const value = getGithubToken(env);
  if (!value) throw new Error("GITHUB_TOKEN not set");
  return value;
}

export type StorageReadDriver = "blob" | "r2" | "r2_then_blob";
export type StorageWriteDriver = "blob" | "r2";

const DEFAULT_R2_PREFIX = "migrate-dev/";
const NON_PRODUCTION_R2_PREFIX = /^migrate-(dev|test|preview)\/$/;

function normalizeDriver(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function getStorageReadDriver(env: RuntimeEnv = process.env): StorageReadDriver {
  const raw = normalizeDriver(env.STORAGE_READ_DRIVER ?? env.READ_DRIVER);
  if (!raw || raw === "blob") return "blob";
  if (raw === "r2") return "r2";
  if (raw === "r2_then_blob") return "r2_then_blob";
  throw new Error(`STORAGE_READ_DRIVER must be blob | r2 | r2_then_blob (got ${raw})`);
}

export function getStorageWriteDriver(env: RuntimeEnv = process.env): StorageWriteDriver {
  const raw = normalizeDriver(env.STORAGE_WRITE_DRIVER ?? env.WRITE_DRIVER);
  if (!raw || raw === "blob") return "blob";
  if (raw === "r2") return "r2";
  throw new Error(`STORAGE_WRITE_DRIVER must be blob | r2 (got ${raw})`);
}

export function getR2AccountId(env: RuntimeEnv = process.env): string | undefined {
  return env.R2_ACCOUNT_ID || undefined;
}

export function getR2AccessKeyId(env: RuntimeEnv = process.env): string | undefined {
  return env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || undefined;
}

export function getR2SecretAccessKey(env: RuntimeEnv = process.env): string | undefined {
  return env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || undefined;
}

export function getR2Bucket(env: RuntimeEnv = process.env): string | undefined {
  return env.R2_BUCKET || env.AWS_S3_BUCKET || undefined;
}

export function getR2Region(env: RuntimeEnv = process.env): string {
  return (env.R2_REGION || env.AWS_REGION || "auto").trim() || "auto";
}

export function getR2S3Endpoint(env: RuntimeEnv = process.env): string {
  const explicit = (env.R2_S3_ENDPOINT || env.AWS_ENDPOINT_URL || "").replace(/\/+$/, "");
  if (explicit) return explicit;
  const accountId = getR2AccountId(env);
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

export function normalizeR2KeyPrefix(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "";
  if (trimmed.includes("..") || trimmed.includes("://")) {
    throw new Error(`refusing unsafe R2_PREFIX "${value}"`);
  }
  return `${trimmed}/`;
}

export function getR2KeyPrefix(env: RuntimeEnv = process.env): string {
  if (env.R2_PREFIX === undefined) return DEFAULT_R2_PREFIX;
  return normalizeR2KeyPrefix(env.R2_PREFIX);
}

export function getR2PublicBaseUrl(env: RuntimeEnv = process.env): string {
  return (env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

export function isVercelProduction(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

export function isNonProductionR2Prefix(prefix: string): boolean {
  return NON_PRODUCTION_R2_PREFIX.test(prefix);
}

export function assertR2WritesAllowed(env: RuntimeEnv = process.env): void {
  if (isVercelProduction(env)) {
    throw new Error("refusing R2 writes: VERCEL_ENV=production (P0 forbids production R2 write)");
  }
  const prefix = getR2KeyPrefix(env);
  if (!isNonProductionR2Prefix(prefix)) {
    throw new Error(
      `refusing R2 writes: R2_PREFIX must be a non-production migrate-* prefix (got "${prefix || "(empty root)"}")`,
    );
  }
}

export function getPublicReadBases(env: RuntimeEnv = process.env): string[] {
  const driver = getStorageReadDriver(env);
  const blob = getBlobBaseUrl(env);
  const r2 = getR2PublicBaseUrl(env);
  switch (driver) {
    case "blob":
      if (!blob) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
      return [blob];
    case "r2":
      if (!r2) throw new Error("R2_PUBLIC_BASE_URL not set — public r2 reads need an R2 public base URL.");
      return [r2];
    case "r2_then_blob": {
      const bases = [r2, blob].filter(Boolean);
      if (bases.length === 0) {
        throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
      }
      return bases;
    }
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage read driver: ${String(_exhaustive)}`);
    }
  }
}

export type WorkflowRuntimeKind = "http" | "memory" | "cf-queue";

export function getWorkflowRuntimeKind(env: RuntimeEnv = process.env): WorkflowRuntimeKind {
  const raw = normalizeDriver(env.WORKFLOW_RUNTIME);
  if (!raw || raw === "http") return "http";
  if (raw === "memory") return "memory";
  if (raw === "cf-queue") return "cf-queue";
  throw new Error(`WORKFLOW_RUNTIME must be http | memory | cf-queue (got ${raw})`);
}

export function getWorkflowQueueEnqueueUrl(env: RuntimeEnv = process.env): string | undefined {
  const value = (env.WORKFLOW_QUEUE_ENQUEUE_URL ?? "").trim();
  return value || undefined;
}

export function requireWorkflowQueueEnqueueUrl(env: RuntimeEnv = process.env): string {
  const value = getWorkflowQueueEnqueueUrl(env);
  if (!value) throw new Error("WORKFLOW_QUEUE_ENQUEUE_URL not set for WORKFLOW_RUNTIME=cf-queue");
  return value;
}

export function getWorkflowStepBaseUrl(env: RuntimeEnv = process.env): string | undefined {
  const explicit = (env.WORKFLOW_STEP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercelUrl = env.VERCEL_URL?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (vercelUrl) return `https://${vercelUrl}`;
  return undefined;
}

export function getCronSecret(env: RuntimeEnv = process.env): string | undefined {
  return env.CRON_SECRET || undefined;
}

export function requireCronSecret(env: RuntimeEnv = process.env): string {
  const value = getCronSecret(env);
  if (!value) throw new Error("CRON_SECRET not set");
  return value;
}

export function getVercelAutomationBypassSecret(env: RuntimeEnv = process.env): string | undefined {
  return env.VERCEL_AUTOMATION_BYPASS_SECRET || undefined;
}
