import { AsyncLocalStorage } from "node:async_hooks";
import { resolveMinTrackedStars } from "./constants.mjs";
import { resolveDataBinding } from "./storage/r2-binding-store";
import { resolveRuntimeEnv } from "./workers-host/runtime-env";

// Runtime configuration boundary for server-side data and workflow modules.
// Keep process.env reads here so tests and route handlers can change config
// without relying on module reloads.

type RuntimeEnv = Record<string, string | undefined>;

/** Caller-supplied env wins. Otherwise merge live Worker bindings over `process.env`. */
function configuredEnv(env?: RuntimeEnv): RuntimeEnv {
  return env ?? resolveRuntimeEnv();
}

const cloudflareWorkersHostOverride = new AsyncLocalStorage<boolean>();

/**
 * Pin `isCloudflareWorkersHost()` for the current async scope.
 * Explicit env objects still win. Used so bun test files that mutate
 * `process.env.HOSTING_TARGET` cannot flip a sibling rankings/detail probe.
 */
export function runWithCloudflareWorkersHostForTests<T>(isCf: boolean, fn: () => T): T {
  return cloudflareWorkersHostOverride.run(isCf, fn);
}

export function getBlobBaseUrl(env?: RuntimeEnv): string {
  const runtime = env ?? resolveRuntimeEnv();
  return (runtime.BLOB_BASE_URL ?? runtime.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
}

/** Process-level Blob base for runners that must not name the env key themselves. */
export function assignBlobBaseUrl(value: string | undefined): void {
  if (value === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = value;
}

/** Process-level public Blob fallback. `undefined` clears it. */
export function assignNextPublicBlobBaseUrl(value: string | undefined): void {
  if (value === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = value;
}

export function requireBlobBaseUrl(env?: RuntimeEnv): string {
  const value = getBlobBaseUrl(env);
  if (!value) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  return value;
}

/** `refresh-YYYY-MM-DDTHH-MM-SS-mmmZ`, the same shape as a refresh run id. */
const VIEWS_VERSION_FALLBACK_PATTERN = /^refresh-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
const INVALID_VIEWS_VERSION_FALLBACK_MESSAGE =
  "[views-version-fallback] ignoring VIEWS_VERSION_FALLBACK because it does not match refresh-YYYY-MM-DDTHH-MM-SS-mmmZ";
let invalidViewsVersionFallbackLogged = false;

/**
 * Optional published-read version used only when `views/latest.json` is a
 * confirmed 404 (#553, incident #543). Blank means unset. Any other value
 * that is not a refresh version id is ignored, and that rejection is logged
 * once per isolate. Write paths must not treat this as a pointer.
 */
export function getViewsVersionFallback(env?: RuntimeEnv): string | null {
  return readViewsVersionFallback(env ?? resolveRuntimeEnv());
}

function readViewsVersionFallback(env: RuntimeEnv): string | null {
  const raw = env.VIEWS_VERSION_FALLBACK;
  if (raw == null || raw === "") return null;
  if (VIEWS_VERSION_FALLBACK_PATTERN.test(raw)) return raw;
  if (!invalidViewsVersionFallbackLogged) {
    invalidViewsVersionFallbackLogged = true;
    console.warn(INVALID_VIEWS_VERSION_FALLBACK_MESSAGE);
  }
  return null;
}

/** Test hook. The invalid-value warning is once per isolate. */
export function resetViewsVersionFallbackLogForTests(): void {
  invalidViewsVersionFallbackLogged = false;
}

export function getBlobWriteToken(env?: RuntimeEnv): string | undefined {
  const runtime = env ?? resolveRuntimeEnv();
  return runtime.BLOB_READ_WRITE_TOKEN || undefined;
}

export function requireBlobWriteToken(env?: RuntimeEnv): string {
  const value = getBlobWriteToken(env);
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN not set");
  return value;
}

export function getGithubToken(env?: RuntimeEnv): string | undefined {
  const runtime = env ?? resolveRuntimeEnv();
  return runtime.GITHUB_TOKEN || undefined;
}

export function requireGithubToken(env?: RuntimeEnv): string {
  const value = getGithubToken(env);
  if (!value) throw new Error("GITHUB_TOKEN not set");
  return value;
}

/** Search / refresh membership floor. Default 10_000; pre sets MIN_TRACKED_STARS=1000. */
export function getMinTrackedStars(env: RuntimeEnv = process.env): number {
  return resolveMinTrackedStars(env.MIN_TRACKED_STARS);
}

/**
 * Multi-hop GitHub Search for whitelist. Off by default (single hop).
 * Preview wrangler `env.pre` sets `1` so ≥1k Search stays inside the
 * `gitstarclub-jobs-pre` 15 min Queue wall. `0` / unset restores #508 single-hop.
 */
export function isWhitelistSearchSharded(env: RuntimeEnv = process.env): boolean {
  return env.WHITELIST_SEARCH_SHARDS === "1";
}

export type DeployEnv = "production" | "pre" | "local";

function normalizedDeployEnv(env: RuntimeEnv): string {
  return (env.DEPLOY_ENV ?? "").trim().toLowerCase();
}

/**
 * `production` | `pre` | `local`, or null when unset. Any other value throws.
 * Worker bindings are visible when the caller omits `env`.
 */
export function getDeployEnv(env?: RuntimeEnv): DeployEnv | null {
  const runtime = configuredEnv(env);
  const raw = normalizedDeployEnv(runtime);
  if (!raw) return null;
  if (raw === "production" || raw === "pre" || raw === "local") return raw;
  throw new Error(`DEPLOY_ENV must be production | pre | local (got ${JSON.stringify(runtime.DEPLOY_ENV)})`);
}

/**
 * Production on Vercel (`VERCEL_ENV=production`) or on Cloudflare
 * (`DEPLOY_ENV=production`). Cloudflare Workers do not set `VERCEL_ENV`.
 */
export function isProductionDeployment(env?: RuntimeEnv): boolean {
  const runtime = configuredEnv(env);
  if (runtime.VERCEL_ENV === "production") return true;
  return normalizedDeployEnv(runtime) === "production";
}

/** Preview-only arm. Production signals and an unset DEPLOY_ENV stay off. */
function isPreDeployment(env: RuntimeEnv): boolean {
  return normalizedDeployEnv(env) === "pre" && env.VERCEL_ENV !== "production";
}

/**
 * Preview-only: treat missing/empty canonical shards as empty placeholders
 * so workflow preflight does not void the run. Off unless `DEPLOY_ENV=pre`
 * and the flag is exactly `1`. Unset `DEPLOY_ENV` (including
 * `HOSTING_TARGET=cf`) and production stay fail-closed.
 */
export function isPreviewPreflightEmptyShardRelaxed(env?: RuntimeEnv): boolean {
  const runtime = configuredEnv(env);
  return runtime.PREFLIGHT_RELAX_EMPTY_SHARDS === "1" && isPreDeployment(runtime);
}

/**
 * Preview-only: first managed refresh may bootstrap canonical meta and treat
 * missing canonical / lookup inputs as empty until views/latest.json exists.
 * Off unless `DEPLOY_ENV=pre` and the flag is exactly `1`. Unset `DEPLOY_ENV`
 * (including `HOSTING_TARGET=cf`) and production never arm cold-start.
 */
export function isWorkflowColdStartEnabled(env?: RuntimeEnv): boolean {
  const runtime = configuredEnv(env);
  return runtime.WORKFLOW_COLD_START === "1" && isPreDeployment(runtime);
}

/** Default hop budget: 10 min. Queue consumer wall is 15 min. */
export const DEFAULT_WHITELIST_SEARCH_HOP_BUDGET_MS = 10 * 60 * 1000;
/** Stop starting Search requests this far before the hop deadline. */
export const WHITELIST_SEARCH_YIELD_SLACK_MS = 90 * 1000;
const MIN_WHITELIST_SEARCH_HOP_BUDGET_MS = 60 * 1000;
const MAX_WHITELIST_SEARCH_HOP_BUDGET_MS = 14 * 60 * 1000;

/** Per-hop Search wall. Must stay below the 15 min Queue consumer wall. */
export function getWhitelistSearchHopBudgetMs(env: RuntimeEnv = process.env): number {
  const raw = env.WHITELIST_SEARCH_HOP_BUDGET_MS;
  if (raw == null || raw.trim() === "") return DEFAULT_WHITELIST_SEARCH_HOP_BUDGET_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_WHITELIST_SEARCH_HOP_BUDGET_MS || value > MAX_WHITELIST_SEARCH_HOP_BUDGET_MS) {
    throw new Error(
      `WHITELIST_SEARCH_HOP_BUDGET_MS must be an integer ${MIN_WHITELIST_SEARCH_HOP_BUDGET_MS}..${MAX_WHITELIST_SEARCH_HOP_BUDGET_MS} (got ${JSON.stringify(raw)})`,
    );
  }
  return value;
}

export type StorageReadDriver = "blob" | "r2_binding" | "r2_s3" | "r2" | "r2_then_blob";
export type StorageWriteDriver = "blob" | "r2_binding" | "r2_s3" | "r2";

/** Bucket-root object that names the bucket and which deploy env may write it. */
export const BUCKET_IDENTITY_KEY = "_meta/bucket-identity.json";

export type BucketIdentity = {
  bucket: string;
  deploy_env: "production" | "pre";
};

function normalizeDriver(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function getStorageReadDriver(env?: RuntimeEnv): StorageReadDriver {
  const runtime = configuredEnv(env);
  const raw = normalizeDriver(runtime.STORAGE_READ_DRIVER ?? runtime.READ_DRIVER);
  if (!raw || raw === "blob") return "blob";
  if (raw === "r2_binding") return "r2_binding";
  if (raw === "r2_s3") return "r2_s3";
  if (raw === "r2") return "r2";
  if (raw === "r2_then_blob") return "r2_then_blob";
  throw new Error(`STORAGE_READ_DRIVER must be blob | r2_binding | r2_s3 | r2 | r2_then_blob (got ${raw})`);
}

export function getStorageWriteDriver(env?: RuntimeEnv): StorageWriteDriver {
  const runtime = configuredEnv(env);
  const raw = normalizeDriver(runtime.STORAGE_WRITE_DRIVER ?? runtime.WRITE_DRIVER);
  if (!raw || raw === "blob") return "blob";
  if (raw === "r2_binding") return "r2_binding";
  if (raw === "r2_s3") return "r2_s3";
  if (raw === "r2") return "r2";
  throw new Error(`STORAGE_WRITE_DRIVER must be blob | r2_binding | r2_s3 | r2 (got ${raw})`);
}

export function getR2AccountId(env?: RuntimeEnv): string | undefined {
  return configuredEnv(env).R2_ACCOUNT_ID || undefined;
}

export function getR2AccessKeyId(env?: RuntimeEnv): string | undefined {
  const runtime = configuredEnv(env);
  return runtime.R2_ACCESS_KEY_ID || runtime.AWS_ACCESS_KEY_ID || undefined;
}

export function getR2SecretAccessKey(env?: RuntimeEnv): string | undefined {
  const runtime = configuredEnv(env);
  return runtime.R2_SECRET_ACCESS_KEY || runtime.AWS_SECRET_ACCESS_KEY || undefined;
}

export function getR2Bucket(env?: RuntimeEnv): string | undefined {
  const runtime = configuredEnv(env);
  return runtime.R2_BUCKET || runtime.AWS_S3_BUCKET || undefined;
}

export function getR2Region(env?: RuntimeEnv): string {
  const runtime = configuredEnv(env);
  return (runtime.R2_REGION || runtime.AWS_REGION || "auto").trim() || "auto";
}

export function getR2S3Endpoint(env?: RuntimeEnv): string {
  const runtime = configuredEnv(env);
  const explicit = (runtime.R2_S3_ENDPOINT || runtime.AWS_ENDPOINT_URL || "").replace(/\/+$/, "");
  if (explicit) return explicit;
  const accountId = getR2AccountId(runtime);
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

/** Unset or blank `R2_PREFIX` is the bucket root. There is no migrate-dev default. */
export function getR2KeyPrefix(env?: RuntimeEnv): string {
  const runtime = configuredEnv(env);
  if (runtime.R2_PREFIX == null || runtime.R2_PREFIX.trim() === "") return "";
  return normalizeR2KeyPrefix(runtime.R2_PREFIX);
}

export function getR2PublicBaseUrl(env?: RuntimeEnv): string {
  return (configuredEnv(env).R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

export function isVercelProduction(env: RuntimeEnv = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * `DEPLOY_ENV` must be `production` or `pre` before any R2 write.
 * Unset on Cloudflare is refused without reading the bucket.
 * `VERCEL_ENV=production` conflicts with any other `DEPLOY_ENV`, the same
 * conflict `isPreDeployment` already applies to cold start.
 */
export function assertR2WriteDeployEnv(env?: RuntimeEnv): "production" | "pre" {
  const runtime = configuredEnv(env);
  let deploy: DeployEnv | null;
  try {
    deploy = getDeployEnv(runtime);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`refusing R2 writes: ${message}`);
  }
  if (deploy == null) {
    if (getHostingTarget(runtime) === "cf") {
      throw new Error("refusing R2 writes: DEPLOY_ENV is unset on Cloudflare");
    }
    throw new Error("refusing R2 writes: DEPLOY_ENV is unset");
  }
  if (deploy !== "production" && deploy !== "pre") {
    throw new Error(`refusing R2 writes: DEPLOY_ENV=${deploy} has no bucket identity`);
  }
  if (runtime.VERCEL_ENV === "production" && deploy !== "production") {
    throw new Error(`refusing R2 writes: VERCEL_ENV=production conflicts with DEPLOY_ENV=${deploy}`);
  }
  return deploy;
}

function parseBucketIdentity(body: string): BucketIdentity {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("not an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.bucket !== "string" || record.bucket.trim() === "") {
    throw new Error("bucket is missing");
  }
  if (record.deploy_env !== "production" && record.deploy_env !== "pre") {
    throw new Error("deploy_env is invalid");
  }
  return { bucket: record.bucket, deploy_env: record.deploy_env };
}

/** Positive identity matches only. Failures are not cached. */
const positiveBucketIdentityCache = new Set<string>();

export function resetBucketIdentityCacheForTests(): void {
  positiveBucketIdentityCache.clear();
}

/** Same trailing-slash strip as `R2S3ObjectStore`, so extras and the client share a cache key. */
function bucketIdentityCacheEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

/**
 * Refuse an R2 write unless `_meta/bucket-identity.json` in the target bucket
 * says this bucket and the same `deploy_env` as `DEPLOY_ENV`.
 * A passing check is cached for the isolate. `endpoint` is the endpoint the
 * store uses after extras; it is not re-derived from env.
 */
export async function assertR2WritesAllowed(
  env: RuntimeEnv | undefined,
  readIdentity: () => Promise<string | null>,
  bucket: string,
  endpoint: string,
): Promise<void> {
  const runtime = configuredEnv(env);
  const deploy = assertR2WriteDeployEnv(runtime);
  const target = bucket.trim();
  if (!target) throw new Error("refusing R2 writes: R2 bucket name is unset");
  const cacheKey = `${bucketIdentityCacheEndpoint(endpoint)}\0${target}\0${deploy}`;
  if (positiveBucketIdentityCache.has(cacheKey)) return;

  let body: string | null;
  try {
    body = await readIdentity();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`refusing R2 writes: bucket identity marker is unreadable (${message})`);
  }
  if (body == null || body.trim() === "") {
    throw new Error("refusing R2 writes: bucket identity marker is missing");
  }
  let identity: BucketIdentity;
  try {
    identity = parseBucketIdentity(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`refusing R2 writes: bucket identity marker is unreadable (${message})`);
  }
  if (identity.bucket !== target) {
    throw new Error(
      `refusing R2 writes: bucket identity bucket "${identity.bucket}" does not match target "${target}"`,
    );
  }
  if (identity.deploy_env !== deploy) {
    throw new Error(
      `refusing R2 writes: bucket identity deploy_env=${identity.deploy_env} does not match DEPLOY_ENV=${deploy}`,
    );
  }
  positiveBucketIdentityCache.add(cacheKey);
}

export function getPublicReadBases(env?: RuntimeEnv): string[] {
  const runtime = configuredEnv(env);
  const driver = getStorageReadDriver(runtime);
  const blob = getBlobBaseUrl(runtime);
  const r2 = getR2PublicBaseUrl(runtime);
  switch (driver) {
    case "blob":
      if (!blob) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
      return [blob];
    case "r2":
    case "r2_s3":
    case "r2_binding":
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

/** Primary public read base. Blob with no URL throws the same error as `requireBlobBaseUrl`. */
export function requirePublicReadBase(env?: RuntimeEnv): string {
  const primary = getPublicReadBases(env)[0];
  if (!primary) throw new Error("BLOB_BASE_URL not set — point it at the Vercel Blob store base URL.");
  return primary;
}

const R2_S3_WRITE_CONFIG_ERROR =
  "R2 driver requires R2_ACCESS_KEY_ID (or AWS_ACCESS_KEY_ID), R2_SECRET_ACCESS_KEY (or AWS_SECRET_ACCESS_KEY), R2_BUCKET (or AWS_S3_BUCKET), and R2_S3_ENDPOINT or R2_ACCOUNT_ID";

/**
 * Write-driver config check. Does not read the bucket-identity marker and
 * does not include secret values in errors.
 * `blob` still requires the Blob base URL and `BLOB_READ_WRITE_TOKEN`.
 */
export function requireStorageWriteConfig(env?: RuntimeEnv): void {
  const runtime = configuredEnv(env);
  const driver = getStorageWriteDriver(runtime);
  switch (driver) {
    case "blob":
      requireBlobBaseUrl(runtime);
      requireBlobWriteToken(runtime);
      return;
    case "r2_binding":
      assertR2WriteDeployEnv(runtime);
      if (!getR2Bucket(runtime)) throw new Error("r2_binding writes require R2_BUCKET");
      resolveDataBinding();
      return;
    case "r2":
    case "r2_s3": {
      assertR2WriteDeployEnv(runtime);
      const accessKeyId = getR2AccessKeyId(runtime);
      const secretAccessKey = getR2SecretAccessKey(runtime);
      const bucket = getR2Bucket(runtime);
      const endpoint = getR2S3Endpoint(runtime);
      if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
        throw new Error(R2_S3_WRITE_CONFIG_ERROR);
      }
      return;
    }
    default: {
      const _exhaustive: never = driver;
      throw new Error(`unsupported storage write driver: ${String(_exhaustive)}`);
    }
  }
}

/**
 * React cache identity for readers that vary by the public origin.
 * A missing Blob base stays "" so that path does not throw here.
 */
export function getPublicReadCacheKey(env?: RuntimeEnv): string {
  const runtime = configuredEnv(env);
  if (getStorageReadDriver(runtime) === "blob") return getBlobBaseUrl(runtime);
  return getPublicReadBases(runtime).join("\n");
}

function readLivePublicReadBaseUrl(env: RuntimeEnv): string {
  return (env.LIVE_PUBLIC_READ_BASE_URL ?? "").replace(/\/+$/, "");
}

/** Explicit live-gate read base. Empty when unset. Stage 6 drops the Blob URL fallback. */
export function getLivePublicReadBaseUrl(env?: RuntimeEnv): string {
  return readLivePublicReadBaseUrl(configuredEnv(env));
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

export type CacheInvalidationKind = "vercel" | "memory" | "cf-stub";
export type PreviewTarget = "vercel" | "cf";
export type HostingTarget = "vercel" | "cf";

// Preview Worker gitstarclub-web-pre only. Production workers.dev
// (gitstarclub-web.worldgo.workers.dev) is closed and must not be the default.
export const DEFAULT_CF_PREVIEW_ORIGIN = "https://gitstarclub-web-pre.worldgo.workers.dev";

export function getCacheInvalidationKind(env: RuntimeEnv = process.env): CacheInvalidationKind {
  const raw = normalizeDriver(env.CACHE_INVALIDATION_DRIVER);
  if (!raw || raw === "vercel") return "vercel";
  if (raw === "memory") return "memory";
  if (raw === "cf-stub") return "cf-stub";
  throw new Error(`CACHE_INVALIDATION_DRIVER must be vercel | memory | cf-stub (got ${raw})`);
}

export function getCfCachePurgeUrl(env: RuntimeEnv = process.env): string | undefined {
  const value = (env.CF_CACHE_PURGE_URL ?? "").trim();
  return value || undefined;
}

export function assertCacheInvalidationAllowed(env: RuntimeEnv = process.env): void {
  const kind = getCacheInvalidationKind(env);
  if (!isVercelProduction(env)) return;
  if (kind === "vercel") return;
  throw new Error(
    `refusing CACHE_INVALIDATION_DRIVER=${kind}: VERCEL_ENV=production keeps Next revalidatePath/Tag (P2)`,
  );
}

export function getPreviewTarget(env: RuntimeEnv = process.env): PreviewTarget {
  const raw = normalizeDriver(env.PREVIEW_TARGET);
  if (!raw || raw === "vercel") return "vercel";
  if (raw === "cf") return "cf";
  throw new Error(`PREVIEW_TARGET must be vercel | cf (got ${raw})`);
}

export function assertPreviewTargetAllowed(env: RuntimeEnv = process.env): void {
  const target = getPreviewTarget(env);
  if (!isVercelProduction(env)) return;
  if (target === "vercel") return;
  throw new Error("refusing PREVIEW_TARGET=cf: VERCEL_ENV=production keeps Vercel preview/product-gates (P2)");
}

export function getCfPreviewOrigin(env: RuntimeEnv = process.env): string {
  const explicit = (env.CF_PREVIEW_ORIGIN ?? "").trim().replace(/\/+$/, "");
  return explicit || DEFAULT_CF_PREVIEW_ORIGIN;
}

export function getCfAccessClientId(env: RuntimeEnv = process.env): string | undefined {
  const value = (env.CF_ACCESS_CLIENT_ID ?? "").trim();
  return value || undefined;
}

export function getCfAccessClientSecret(env: RuntimeEnv = process.env): string | undefined {
  const value = (env.CF_ACCESS_CLIENT_SECRET ?? "").trim();
  return value || undefined;
}

export function getCfPreviewRequireSha(env: RuntimeEnv = process.env): boolean {
  return env.CF_PREVIEW_REQUIRE_SHA === "1";
}

export function requireCfAccessCredentials(env: RuntimeEnv = process.env): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = getCfAccessClientId(env);
  const clientSecret = getCfAccessClientSecret(env);
  if (!clientId || !clientSecret) {
    throw new Error(
      "CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are required to reach the Access-protected CF Preview host",
    );
  }
  return { clientId, clientSecret };
}

export function getHostingTarget(env: RuntimeEnv = process.env): HostingTarget {
  const raw = normalizeDriver(env.HOSTING_TARGET ?? env.NEXT_PUBLIC_HOSTING_TARGET);
  if (!raw || raw === "vercel") return "vercel";
  if (raw === "cf") return "cf";
  throw new Error(`HOSTING_TARGET must be vercel | cf (got ${raw})`);
}

export function isCloudflareWorkersHost(env?: RuntimeEnv): boolean {
  if (env !== undefined) {
    return getHostingTarget(env) === "cf" && !isVercelProduction(env);
  }
  const override = cloudflareWorkersHostOverride.getStore();
  if (override !== undefined) return override;
  return getHostingTarget(process.env) === "cf" && !isVercelProduction(process.env);
}

export function assertHostingTargetAllowed(env: RuntimeEnv = process.env): void {
  const target = getHostingTarget(env);
  if (!isVercelProduction(env)) return;
  if (target === "vercel") return;
  throw new Error("refusing HOSTING_TARGET=cf: VERCEL_ENV=production stays on Vercel (P3)");
}
