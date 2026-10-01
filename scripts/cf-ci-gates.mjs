import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_WORKER_NAME = "gitstarclub-web";
export const PREVIEW_WORKER_NAME = "gitstarclub-web-pre";
export const PREVIEW_WRANGLER_ENV = "pre";
export const CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN = "https://gitstarclub-web.worldgo.workers.dev";
export const DEFAULT_CF_PREVIEW_ORIGIN = "https://gitstarclub-web-pre.worldgo.workers.dev";
export const ALLOWED_CF_PREVIEW_ORIGINS = Object.freeze([
  DEFAULT_CF_PREVIEW_ORIGIN,
  "https://pre.gitstarclub.com",
]);
export const PRODUCTION_CRON_ORIGIN = "https://gitstarclub.com";
export const PREVIEW_CRON_ORIGIN = "https://pre.gitstarclub.com";
// Cloudflare Cron Triggers number weekdays 1 = Sunday ... 7 = Saturday and reject 0
// (API 10100). See https://developers.cloudflare.com/workers/configuration/cron-triggers/.
// Use SUN for Sunday. These are the intended env.pre expressions once preview is re-enabled.
export const PREVIEW_CRON_TRIGGERS = Object.freeze(["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]);
// Preview schedules are paused by the owner (shared-store incident #543), so
// wrangler env.pre triggers.crons must be []. To re-enable, in one PR set
// env.pre triggers.crons to PREVIEW_CRON_TRIGGERS and flip this to false.
export const PREVIEW_CRONS_PAUSED = true;
export const PRODUCTION_MIN_TRACKED_STARS = "10000";
// Own literal. Do not alias this to a preview Blob URL. Preview no longer has one.
export const PRODUCTION_BLOB_BASE_URL =
  "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com";
export const PREVIEW_R2_BUCKET = "gitstarclub-data-pre";
export const PRODUCTION_R2_BUCKET = "gitstarclub-data-prod";
export const PREVIEW_R2_PUBLIC_HOST = "data-pre.gitstarclub.com";
export const PRODUCTION_R2_PUBLIC_HOST = "data.gitstarclub.com";
export const PREVIEW_R2_PUBLIC_BASE_URL = "https://data-pre.gitstarclub.com";
export const PREVIEW_DEPLOY_ENV = "pre";
// `r2` and `r2_s3` both read R2_PUBLIC_BASE_URL. Preview locks `r2`.
export const PREVIEW_STORAGE_READ_DRIVER = "r2";
export const PREVIEW_STORAGE_WRITE_DRIVER = "r2_binding";
export const PREVIEW_QUEUE_NAME = "gitstarclub-jobs-pre";
export const PREVIEW_WORKFLOW_RUNTIME = "cf-queue";
export const PRODUCTION_WORKFLOW_RUNTIME = PREVIEW_WORKFLOW_RUNTIME;
export const PREVIEW_WORKFLOW_QUEUE_ENQUEUE_URL = "https://pre.gitstarclub.com/enqueue";
export const PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL = "https://gitstarclub.com/enqueue";
// Last complete views version while views/latest.json is missing (#543 / #553).
// Remove this, and the top-level wrangler var, once the pointer is restored.
export const PRODUCTION_VIEWS_VERSION_FALLBACK = "refresh-2026-09-13T06-00-16-398Z";
export const ASSERT_SCRIPT_REL = "scripts/assert-cf-ci-gates.mjs";

const LEGACY_PREVIEW_WORKER_NAME = "gitstarclub-web-nonprod";
const WRANGLER_CONFIG_REL = "workers/gitstarclub-web/wrangler.jsonc";
const NAMING_DOC_RELS = Object.freeze(["docs/OPS.md", "docs/TESTING.md", "docs/README.md"]);

export function stripJsonc(source) {
  const output = [];
  let inString = false;
  let escaped = false;
  let comment = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    const isNewline = char === "\n" || char === "\r";
    if (comment !== null) {
      // Whitespace keeps tokens separate and preserves source locations.
      if (comment === "block" && char === "*" && next === "/") {
        output.push("  ");
        index += 1;
        comment = null;
      } else {
        output.push(isNewline ? char : " ");
        if (comment === "line" && isNewline) comment = null;
      }
      continue;
    }
    if (inString) {
      output.push(char);
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === "/" && (next === "/" || next === "*")) {
      comment = next === "/" ? "line" : "block";
      output.push("  ");
      index += 1;
    } else {
      output.push(char);
      if (char === '"') inString = true;
    }
  }
  if (comment === "block") throw new SyntaxError("Unterminated JSONC block comment");
  return output.join("");
}

export function parseWranglerJsonc(source) {
  return JSON.parse(stripJsonc(source));
}

function namedR2Bucket(buckets, binding) {
  if (!Array.isArray(buckets)) return undefined;
  for (const entry of buckets) {
    if (entry && entry.binding === binding) return entry.bucket_name;
  }
  return undefined;
}

function jsonMentions(value, needle) {
  return JSON.stringify(value ?? null).includes(needle);
}

// Host allow/deny is case-insensitive. URL hostname comparison folds case, and
// `DATA.gitstarclub.com` is still the production host inside env.pre.
function jsonMentionsHost(value, host) {
  return JSON.stringify(value ?? null).toLowerCase().includes(String(host).toLowerCase());
}

function isUnsetOrBlobDriver(value) {
  if (value === undefined) return true;
  const folded = String(value).trim().toLowerCase();
  return folded === "" || folded === "blob";
}

export function readDefaultCfPreviewOrigin(runtimeConfigSource) {
  const match = runtimeConfigSource.match(/export const DEFAULT_CF_PREVIEW_ORIGIN = "([^"]+)"/);
  if (!match) {
    throw new Error("web/lib/runtime-config.ts must export DEFAULT_CF_PREVIEW_ORIGIN as a string literal");
  }
  return match[1];
}

export function normalizeCfPreviewOrigin(origin) {
  return String(origin ?? "").trim().replace(/\/+$/, "");
}

function isAllowedPreviewOrigin(origin) {
  return ALLOWED_CF_PREVIEW_ORIGINS.includes(normalizeCfPreviewOrigin(origin));
}

export function assertAllowedCfPreviewOrigin(origin) {
  const normalized = normalizeCfPreviewOrigin(origin);
  if (!normalized) {
    throw new Error("CF_PREVIEW_ORIGIN is empty; expected a preview Worker entry");
  }
  if (normalized === CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN) {
    throw new Error("CF_PREVIEW_ORIGIN must not point at the closed production workers.dev host");
  }
  if (normalized.includes(`${PRODUCTION_WORKER_NAME}.`) && !normalized.includes(PREVIEW_WORKER_NAME)) {
    throw new Error(
      `CF_PREVIEW_ORIGIN must not target production Worker ${PRODUCTION_WORKER_NAME} (received ${origin})`,
    );
  }
  if (!isAllowedPreviewOrigin(normalized)) {
    throw new Error(
      `CF_PREVIEW_ORIGIN must be ${ALLOWED_CF_PREVIEW_ORIGINS.join(" or ")} (received ${origin})`,
    );
  }
  return normalized;
}

function readFlagValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === name) {
      values.push(args[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) values.push(arg.slice(name.length + 1));
  }
  return values;
}

function quote(value) {
  return JSON.stringify(value);
}

export function planCfWranglerDryRun(userArgs = []) {
  if (userArgs.some((arg) => arg === "--dry-run=false" || arg === "--dry-run=0")) {
    throw new Error("cf:dry-run refuses to disable --dry-run; GHA must never live-deploy a Worker");
  }

  const names = readFlagValues(userArgs, "--name");
  for (const name of names) {
    if (name === PRODUCTION_WORKER_NAME) {
      throw new Error(
        `cf:dry-run refuses --name ${PRODUCTION_WORKER_NAME}; that is the production Worker. Use wrangler env ${PREVIEW_WRANGLER_ENV} (${PREVIEW_WORKER_NAME})`,
      );
    }
    if (name && name !== PREVIEW_WORKER_NAME) {
      throw new Error(`cf:dry-run only allows Worker ${PREVIEW_WORKER_NAME} (received --name ${quote(name)})`);
    }
  }

  const envs = readFlagValues(userArgs, "--env");
  for (const env of envs) {
    if (env !== PREVIEW_WRANGLER_ENV) {
      throw new Error(
        `cf:dry-run only allows --env ${PREVIEW_WRANGLER_ENV} (Worker ${PREVIEW_WORKER_NAME}). Empty/top-level env would target production ${PRODUCTION_WORKER_NAME}`,
      );
    }
  }

  const passthrough = [];
  for (let index = 0; index < userArgs.length; index += 1) {
    const arg = userArgs[index];
    if (arg === "--dry-run" || arg === "--env" || arg === "--name" || arg === "--config") {
      if (arg !== "--dry-run") index += 1;
      continue;
    }
    if (arg.startsWith("--dry-run=") || arg.startsWith("--env=") || arg.startsWith("--name=") || arg.startsWith("--config=")) {
      continue;
    }
    passthrough.push(arg);
  }

  return {
    argv: [
      "deploy",
      "--dry-run",
      "--config",
      `../${WRANGLER_CONFIG_REL}`,
      "--env",
      PREVIEW_WRANGLER_ENV,
      ...passthrough,
    ],
    wranglerEnv: PREVIEW_WRANGLER_ENV,
    workerName: PREVIEW_WORKER_NAME,
    dryRun: true,
  };
}

function isSkippableSourceLine(trimmed) {
  return !trimmed || trimmed.startsWith("#") || trimmed.startsWith("//");
}

function commandHasEffectiveDryRun(command) {
  if (/--dry-run(?:=false|=0)\b/.test(command)) return false;
  return /--dry-run(?:\s|=|$)/.test(command);
}

export function findWranglerDeployInvocations(text) {
  const invocations = [];
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (isSkippableSourceLine(trimmed)) continue;
    const match = trimmed.match(/(?:bunx\s+|npx\s+|bun\s+x\s+)?wrangler\s+(deploy|versions\s+upload)\b(.*)/);
    if (!match) continue;
    const command = `wrangler ${match[1]}${match[2] ?? ""}`;
    invocations.push({
      command,
      hasDryRun: commandHasEffectiveDryRun(command),
    });
  }
  return invocations;
}

export function findForbiddenCloudflareMutations(text) {
  const issues = [];
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (isSkippableSourceLine(trimmed)) continue;
    if (!/schedules/i.test(trimmed)) continue;
    const writesSchedule =
      /\bPUT\b/.test(trimmed) || /method:\s*["']PUT["']/.test(trimmed) || /["']PUT["']/.test(trimmed);
    if (!writesSchedule) continue;
    issues.push(`refusing Cloudflare schedule mutation in repo automation: ${trimmed}`);
  }
  return issues;
}

function ciPreviewOriginFallback(ciYml) {
  const match = ciYml.match(/CF_PREVIEW_ORIGIN:\s*\$\{\{\s*vars\.CF_PREVIEW_ORIGIN\s*\|\|\s*'([^']+)'\s*\}\}/);
  return match?.[1] ?? null;
}

function jobMentionsPreAllowlist(ciYml, jobId) {
  const start = ciYml.indexOf(`  ${jobId}:`);
  if (start === -1) return false;
  const next = ciYml.slice(start + 1).search(/\n  [a-z0-9-]+:/i);
  const block = next === -1 ? ciYml.slice(start) : ciYml.slice(start, start + 1 + next);
  return block.includes("github.ref_name == 'pre'") && block.includes("github.base_ref == 'pre'");
}

function collectCanonicalNameIssues(text, label) {
  const issues = [];
  if (!text.includes(ASSERT_SCRIPT_REL)) {
    issues.push(`${label} must name ${ASSERT_SCRIPT_REL}`);
  }
  if (!text.includes(PREVIEW_WORKER_NAME)) {
    issues.push(`${label} must name preview Worker ${PREVIEW_WORKER_NAME}`);
  }
  if (!text.includes(PRODUCTION_WORKER_NAME)) {
    issues.push(`${label} must name production Worker ${PRODUCTION_WORKER_NAME}`);
  }
  return issues;
}

function productionCronsAreEmpty(productionCrons) {
  return Array.isArray(productionCrons) && productionCrons.length === 0;
}

const WEEKDAY_TOKEN_SEPARATORS = /[,\-/#]/;

/**
 * True when a cron expression spells a weekday as numeric 0 or 7. On
 * Cloudflare 7 is Saturday (not Sunday) and 0 is rejected, so both are
 * ambiguous with Unix cron. Use three-letter names (SUN, SAT) instead.
 * @param {unknown} cron
 */
export function cronUsesAmbiguousNumericWeekday(cron) {
  if (typeof cron !== "string") return false;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return parts[4].split(WEEKDAY_TOKEN_SEPARATORS).some((token) => /^[07]L?$/i.test(token));
}

/**
 * @param {unknown} previewCrons
 * @param {boolean} paused
 * @returns {string[]}
 */
export function previewCronIssues(previewCrons, paused) {
  const issues = [];
  const label = `wrangler env.${PREVIEW_WRANGLER_ENV} triggers.crons`;
  if (paused) {
    if (!Array.isArray(previewCrons) || previewCrons.length !== 0) {
      issues.push(
        `${label} must be [] while preview schedules are paused (#543); intended when re-enabled: ${JSON.stringify(
          [...PREVIEW_CRON_TRIGGERS],
        )} with PREVIEW_CRONS_PAUSED=false`,
      );
    }
  } else if (JSON.stringify(previewCrons) !== JSON.stringify([...PREVIEW_CRON_TRIGGERS])) {
    issues.push(
      `${label} must be the three Cloudflare expressions ${JSON.stringify([...PREVIEW_CRON_TRIGGERS])} (Cloudflare 1 = Sunday, 7 = Saturday; use SUN)`,
    );
  }
  return issues;
}

/**
 * @typedef {object} CfCiGateSources
 * @property {string} wranglerSource
 * @property {string} ciYml
 * @property {string} deliveryYml
 * @property {string} webPackageSource
 * @property {string} runtimeConfigSource
 * @property {string} [deploySurfaceSource]
 * @property {Record<string, string>} [namingSources]
 * @property {boolean} [previewCronsPaused] Test override for PREVIEW_CRONS_PAUSED.
 */

function collectWorkerIdentityIssues(wrangler, preview) {
  const issues = [];
  if (wrangler.name !== PRODUCTION_WORKER_NAME) {
    issues.push(`wrangler top-level name must be ${PRODUCTION_WORKER_NAME} (production)`);
  }
  if (wrangler.env?.nonprod) {
    issues.push("wrangler env.nonprod is retired; preview lives under env.pre as gitstarclub-web-pre");
  }
  if (JSON.stringify(wrangler).includes(LEGACY_PREVIEW_WORKER_NAME)) {
    issues.push(`wrangler must not name a Worker ${LEGACY_PREVIEW_WORKER_NAME}`);
  }
  if (wrangler.vars?.SITE_INDEXABLE !== "1") {
    issues.push('wrangler top-level vars.SITE_INDEXABLE must be "1"');
  }
  if (wrangler.vars?.NEXT_PUBLIC_SITE_URL !== "https://gitstarclub.com") {
    issues.push("wrangler top-level vars.NEXT_PUBLIC_SITE_URL must be https://gitstarclub.com");
  }
  if (preview?.vars?.SITE_INDEXABLE === "1") {
    issues.push("wrangler env.pre must not enable SITE_INDEXABLE");
  }
  if (!preview) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} is required`);
  } else if (preview.name !== PREVIEW_WORKER_NAME) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV}.name must be ${PREVIEW_WORKER_NAME}`);
  }
  return issues;
}

function collectCronGateIssues(wrangler, preview, previewCronsPaused) {
  const issues = [];
  const productionCrons = wrangler.triggers?.crons;
  if (!productionCronsAreEmpty(productionCrons)) {
    issues.push("wrangler top-level triggers.crons must stay [] until Jason approves production CF Cron");
  }
  const previewCrons = preview?.triggers?.crons;
  if (preview) {
    issues.push(...previewCronIssues(previewCrons, previewCronsPaused));
  }
  for (const [label, crons] of [
    ["top-level", productionCrons],
    [`env.${PREVIEW_WRANGLER_ENV}`, previewCrons],
  ]) {
    if (Array.isArray(crons) && crons.some(cronUsesAmbiguousNumericWeekday)) {
      issues.push(
        `wrangler ${label} triggers.crons must not use numeric weekday 0 or 7 (Cloudflare 1 = Sunday, 7 = Saturday, 0 rejected); use SUN or SAT`,
      );
    }
  }
  return issues;
}

function collectWorkerRuntimeIssues(wrangler, preview) {
  const issues = [];
  const requiredProductionVars = [
    ["BLOB_BASE_URL", PRODUCTION_BLOB_BASE_URL],
    ["NEXT_PUBLIC_BLOB_BASE_URL", PRODUCTION_BLOB_BASE_URL],
    ["CF_CRON_ORIGIN", PRODUCTION_CRON_ORIGIN],
    ["WORKFLOW_RUNTIME", PRODUCTION_WORKFLOW_RUNTIME],
    ["WORKFLOW_QUEUE_ENQUEUE_URL", PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL],
    ["VIEWS_VERSION_FALLBACK", PRODUCTION_VIEWS_VERSION_FALLBACK],
  ];
  for (const [key, expected] of requiredProductionVars) {
    if (wrangler.vars?.[key] !== expected) {
      issues.push(`wrangler top-level vars.${key} must be ${expected}`);
    }
  }
  if (preview?.vars?.VIEWS_VERSION_FALLBACK !== undefined) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.VIEWS_VERSION_FALLBACK must not be set (production-only stopgap for #543)`,
    );
  }
  if (wrangler.workers_dev !== false) {
    issues.push("wrangler top-level workers_dev must be false");
  }
  if (wrangler.preview_urls !== false) {
    issues.push("wrangler top-level preview_urls must be false");
  }
  if (preview && preview.workers_dev !== true) {
    issues.push(
      "wrangler env.pre workers_dev must be true so a preview deploy does not inherit the closed production workers.dev flag",
    );
  }
  if (preview && preview.preview_urls !== true) {
    issues.push(
      "wrangler env.pre preview_urls must be true so a preview deploy does not inherit the closed production preview URL flag",
    );
  }
  if (wrangler.vars?.CF_PREVIEW_COMMIT_SHA !== undefined || preview?.vars?.CF_PREVIEW_COMMIT_SHA !== undefined) {
    issues.push("CF_PREVIEW_COMMIT_SHA must not be committed; pass it with wrangler --var on each deploy");
  }
  const previewOriginVar = preview?.vars?.CF_CRON_ORIGIN;
  if (previewOriginVar !== undefined && previewOriginVar !== PREVIEW_CRON_ORIGIN) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} vars.CF_CRON_ORIGIN must be ${PREVIEW_CRON_ORIGIN} when set`);
  }
  return issues;
}

function collectStorageIsolationIssues(wrangler, preview) {
  const issues = [];
  if (preview && !Array.isArray(preview.r2_buckets)) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} must declare its own r2_buckets (wrangler environments do not inherit r2_buckets)`,
    );
  }
  if (preview && (preview.vars == null || typeof preview.vars !== "object" || Array.isArray(preview.vars))) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} must declare its own vars (wrangler environments do not inherit vars)`,
    );
  }
  const previewDataBucket = namedR2Bucket(preview?.r2_buckets, "DATA");
  if (preview && previewDataBucket !== PREVIEW_R2_BUCKET) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} r2_buckets DATA bucket_name must be ${PREVIEW_R2_BUCKET}`,
    );
  }
  const productionDataBucket = namedR2Bucket(wrangler.r2_buckets, "DATA");
  if (productionDataBucket !== undefined && productionDataBucket !== PRODUCTION_R2_BUCKET) {
    issues.push(
      `wrangler top-level r2_buckets DATA bucket_name must be ${PRODUCTION_R2_BUCKET} when present`,
    );
  }
  if (
    previewDataBucket !== undefined &&
    productionDataBucket !== undefined &&
    previewDataBucket === productionDataBucket
  ) {
    issues.push("wrangler env.pre DATA bucket must differ from the top-level DATA bucket");
  }
  if (jsonMentions(preview, PRODUCTION_R2_BUCKET)) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} must not mention ${PRODUCTION_R2_BUCKET}`);
  }
  if (jsonMentionsHost(preview, PRODUCTION_R2_PUBLIC_HOST)) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} must not mention ${PRODUCTION_R2_PUBLIC_HOST}`);
  }
  const topLevel = { ...wrangler };
  delete topLevel.env;
  if (jsonMentions(topLevel, PREVIEW_R2_BUCKET)) {
    issues.push(`wrangler top-level must not mention ${PREVIEW_R2_BUCKET}`);
  }
  if (jsonMentionsHost(topLevel, PREVIEW_R2_PUBLIC_HOST)) {
    issues.push(`wrangler top-level must not mention ${PREVIEW_R2_PUBLIC_HOST}`);
  }
  return issues;
}

function collectStorageDriverIssues(wrangler, preview) {
  const issues = [];
  // Before R2 cutover (I-5b) the top-level Worker still reads Vercel Blob.
  // DEPLOY_ENV stays unset. Drivers stay unset or blob, including the
  // READ_DRIVER and WRITE_DRIVER aliases. Setting any DEPLOY_ENV, or an R2
  // driver, is the cutover and must update this gate in the same change.
  if (wrangler.vars?.DEPLOY_ENV !== undefined) {
    issues.push(
      `wrangler top-level vars.DEPLOY_ENV must be unset until R2 cutover (received ${quote(wrangler.vars.DEPLOY_ENV)})`,
    );
  }
  for (const key of ["STORAGE_READ_DRIVER", "READ_DRIVER", "STORAGE_WRITE_DRIVER", "WRITE_DRIVER"]) {
    const value = wrangler.vars?.[key];
    if (!isUnsetOrBlobDriver(value)) {
      issues.push(
        `wrangler top-level vars.${key} must be unset or blob until R2 cutover (received ${quote(value)})`,
      );
    }
  }
  if (preview?.vars?.DEPLOY_ENV !== PREVIEW_DEPLOY_ENV) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} vars.DEPLOY_ENV must be ${PREVIEW_DEPLOY_ENV}`);
  }
  if (preview?.vars?.STORAGE_READ_DRIVER !== PREVIEW_STORAGE_READ_DRIVER) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.STORAGE_READ_DRIVER must be ${PREVIEW_STORAGE_READ_DRIVER} (public reads use R2_PUBLIC_BASE_URL)`,
    );
  }
  if (preview?.vars?.STORAGE_WRITE_DRIVER !== PREVIEW_STORAGE_WRITE_DRIVER) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.STORAGE_WRITE_DRIVER must be ${PREVIEW_STORAGE_WRITE_DRIVER}`,
    );
  }
  if (preview?.vars?.R2_BUCKET !== PREVIEW_R2_BUCKET) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} vars.R2_BUCKET must be ${PREVIEW_R2_BUCKET}`);
  }
  if (preview?.vars?.R2_PUBLIC_BASE_URL !== PREVIEW_R2_PUBLIC_BASE_URL) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.R2_PUBLIC_BASE_URL must be ${PREVIEW_R2_PUBLIC_BASE_URL}`,
    );
  }
  const previewPrefix = preview?.vars?.R2_PREFIX;
  if (previewPrefix !== undefined && previewPrefix !== "") {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} vars.R2_PREFIX must be unset or empty`);
  }
  if (jsonMentions(preview, "BLOB_")) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} must not contain BLOB_* (preview reads R2, not Vercel Blob)`,
    );
  }
  return issues;
}

function collectWorkflowRuntimeIssues(wrangler, preview) {
  const issues = [];
  // The 1k-star cold-start experiment (MIN_TRACKED_STARS=1000, WORKFLOW_COLD_START,
  // PREFLIGHT_RELAX_EMPTY_SHARDS) is paused. Preview rehearses at the production floor.
  // Restoring that experiment later is an owner decision.
  const productionMinTracked = wrangler.vars?.MIN_TRACKED_STARS;
  if (productionMinTracked !== undefined && productionMinTracked !== PRODUCTION_MIN_TRACKED_STARS) {
    issues.push(
      `wrangler top-level vars.MIN_TRACKED_STARS must be unset or ${PRODUCTION_MIN_TRACKED_STARS} (production stays ≥10k)`,
    );
  }
  const effectiveProductionMin = productionMinTracked ?? PRODUCTION_MIN_TRACKED_STARS;
  if (preview?.vars?.MIN_TRACKED_STARS !== effectiveProductionMin) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.MIN_TRACKED_STARS must equal production (${effectiveProductionMin})`,
    );
  }
  if (preview?.vars?.WORKFLOW_COLD_START !== undefined) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.WORKFLOW_COLD_START must be absent (1k cold-start experiment is paused; restoring it is an owner decision)`,
    );
  }
  if (wrangler.vars?.WORKFLOW_COLD_START !== undefined) {
    issues.push(
      "wrangler top-level vars.WORKFLOW_COLD_START must be absent (1k cold-start experiment is paused; restoring it is an owner decision)",
    );
  }
  if (preview?.vars?.PREFLIGHT_RELAX_EMPTY_SHARDS !== undefined) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.PREFLIGHT_RELAX_EMPTY_SHARDS must be absent (1k cold-start experiment is paused; restoring it is an owner decision)`,
    );
  }
  if (wrangler.vars?.PREFLIGHT_RELAX_EMPTY_SHARDS !== undefined) {
    issues.push(
      "wrangler top-level vars.PREFLIGHT_RELAX_EMPTY_SHARDS must be absent (1k cold-start experiment is paused; restoring it is an owner decision)",
    );
  }
  const previewWorkflowRuntime = preview?.vars?.WORKFLOW_RUNTIME;
  if (previewWorkflowRuntime !== PREVIEW_WORKFLOW_RUNTIME) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.WORKFLOW_RUNTIME must be ${PREVIEW_WORKFLOW_RUNTIME}`,
    );
  }
  const previewEnqueueUrl = preview?.vars?.WORKFLOW_QUEUE_ENQUEUE_URL;
  if (previewEnqueueUrl !== PREVIEW_WORKFLOW_QUEUE_ENQUEUE_URL) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.WORKFLOW_QUEUE_ENQUEUE_URL must be ${PREVIEW_WORKFLOW_QUEUE_ENQUEUE_URL}`,
    );
  }
  const previewQueueProducer = preview?.queues?.producers?.find((entry) => entry.binding === "JOBS");
  if (previewQueueProducer?.queue !== PREVIEW_QUEUE_NAME) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} queues.producers JOBS must target ${PREVIEW_QUEUE_NAME}`,
    );
  }
  const previewQueueConsumer = preview?.queues?.consumers?.find((entry) => entry.queue === PREVIEW_QUEUE_NAME);
  if (!previewQueueConsumer) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} queues.consumers must include ${PREVIEW_QUEUE_NAME}`,
    );
  }
  return issues;
}

function collectPreviewOriginIssues(runtimeConfigSource, ciYml) {
  const issues = [];
  const defaultOrigin = readDefaultCfPreviewOrigin(runtimeConfigSource);
  if (defaultOrigin === CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN) {
    issues.push("DEFAULT_CF_PREVIEW_ORIGIN must not be the closed production workers.dev host");
  }
  if (!isAllowedPreviewOrigin(defaultOrigin)) {
    issues.push(
      `DEFAULT_CF_PREVIEW_ORIGIN must be ${ALLOWED_CF_PREVIEW_ORIGINS.join(" or ")} (received ${defaultOrigin})`,
    );
  }

  const ciOrigin = ciPreviewOriginFallback(ciYml);
  if (!ciOrigin) {
    issues.push("ci.yml must default CF_PREVIEW_ORIGIN when the repo variable is unset");
  } else if (ciOrigin === CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN) {
    issues.push("ci.yml CF_PREVIEW_ORIGIN fallback must not be the closed production workers.dev host");
  } else if (!isAllowedPreviewOrigin(ciOrigin)) {
    issues.push(`ci.yml CF_PREVIEW_ORIGIN fallback must be a preview entry (received ${ciOrigin})`);
  } else if (ciOrigin !== defaultOrigin) {
    issues.push(`ci.yml CF_PREVIEW_ORIGIN fallback must match DEFAULT_CF_PREVIEW_ORIGIN (${defaultOrigin})`);
  }
  return issues;
}

function collectDeployAutomationIssues(ciYml, webPackageSource, extraSurface) {
  const issues = [];
  const deploySurface = `${ciYml}\n${webPackageSource}\n${extraSurface}`;
  for (const { command, hasDryRun } of findWranglerDeployInvocations(deploySurface)) {
    if (!hasDryRun) {
      issues.push(`refusing bare wrangler deploy (missing --dry-run): ${command.trim()}`);
    }
  }
  issues.push(...findForbiddenCloudflareMutations(deploySurface));

  if (webPackageSource.includes(`--env ""`) || webPackageSource.includes("--env ''")) {
    issues.push('web/package.json must not use wrangler --env "" (top-level name is production gitstarclub-web)');
  }

  if (extraSurface.includes(`--env ""`) || extraSurface.includes("--env ''")) {
    issues.push('automation must not use wrangler --env "" (top-level name is production gitstarclub-web)');
  }

  if (!webPackageSource.includes("scripts/cf-wrangler-dry-run.mjs") && !webPackageSource.includes("cf-wrangler-dry-run")) {
    issues.push("web/package.json cf:dry-run must go through scripts/cf-wrangler-dry-run.mjs");
  }
  return issues;
}

function collectDeliveryContractIssues(deliveryYml) {
  const issues = [];
  if (!/cf-preview[\s\S]*MUST NOT be added/.test(deliveryYml) && !deliveryYml.includes("MUST NOT be added")) {
    issues.push(".delivery.yml must keep cf-preview / cf-workers-host out of required checks");
  }
  const checksMatch = deliveryYml.match(/checks:\s*\[([^\]]+)\]/);
  const requiredChecks = checksMatch?.[1] ?? "";
  const requiredNames = requiredChecks
    .split(",")
    .map((name) => name.replace(/#.*$/, "").trim())
    .filter(Boolean);
  if (!requiredNames.includes("static") || !requiredNames.includes("production-build")) {
    issues.push(".delivery.yml ci.checks must keep static and production-build as required gates");
  }
  if (requiredNames.includes("preview-e2e") || requiredNames.includes("product-gates")) {
    issues.push(".delivery.yml ci.checks must not require preview-e2e or product-gates (they soft-skip without Vercel Preview)");
  }
  if (/\bcf-preview\b/.test(requiredChecks) || /\bcf-workers-host\b/.test(requiredChecks)) {
    issues.push(".delivery.yml ci.checks must not require cf-preview or cf-workers-host");
  }
  issues.push(...collectCanonicalNameIssues(deliveryYml, ".delivery.yml"));
  if (!/triggers\.crons[^\n]*\[\]/.test(deliveryYml)) {
    issues.push(".delivery.yml must keep production triggers.crons [] next to the named assert");
  }
  return issues;
}

function collectCiWorkflowIssues(ciYml) {
  const issues = [];
  if (!ciYml.includes(ASSERT_SCRIPT_REL) && !ciYml.includes("assert-cf-ci-gates.mjs")) {
    issues.push(`ci.yml must run ${ASSERT_SCRIPT_REL}`);
  }
  if (!ciYml.includes("steps.deployment.outputs.skipped") || !ciYml.includes("needs.preview-e2e.outputs.skipped")) {
    issues.push("ci.yml must soft-skip preview-e2e follow-up steps and product-gates when Vercel Preview is skipped");
  }
  if (!ciYml.includes(`${ASSERT_SCRIPT_REL} --preview-origin`) && !ciYml.includes("assert-cf-ci-gates.mjs --preview-origin")) {
    issues.push(`ci.yml cf-preview must allowlist origins via ${ASSERT_SCRIPT_REL} --preview-origin`);
  }

  for (const jobId of ["cf-preview", "cf-workers-host"]) {
    if (!jobMentionsPreAllowlist(ciYml, jobId)) {
      issues.push(`${jobId} must allowlist only github.ref_name == 'pre' or github.base_ref == 'pre'`);
    }
  }
  return issues;
}

/**
 * @param {CfCiGateSources} sources
 * @returns {string[]}
 */
export function assertCfCiGates(sources) {
  const { wranglerSource, ciYml, deliveryYml, webPackageSource, runtimeConfigSource } = sources;
  const wrangler = parseWranglerJsonc(wranglerSource);
  const preview = wrangler.env?.[PREVIEW_WRANGLER_ENV];
  const issues = [
    ...collectWorkerIdentityIssues(wrangler, preview),
    ...collectCronGateIssues(wrangler, preview, sources.previewCronsPaused ?? PREVIEW_CRONS_PAUSED),
    ...collectWorkerRuntimeIssues(wrangler, preview),
    ...collectStorageIsolationIssues(wrangler, preview),
    ...collectStorageDriverIssues(wrangler, preview),
    ...collectWorkflowRuntimeIssues(wrangler, preview),
    ...collectPreviewOriginIssues(runtimeConfigSource, ciYml),
    ...collectDeployAutomationIssues(ciYml, webPackageSource, sources.deploySurfaceSource ?? ""),
    ...collectDeliveryContractIssues(deliveryYml),
    ...collectCiWorkflowIssues(ciYml),
  ];
  for (const [label, text] of Object.entries(sources.namingSources ?? {})) {
    issues.push(...collectCanonicalNameIssues(text, label));
  }
  return issues;
}

function readTextFiles(root, directory, predicate) {
  const absolute = resolve(root, directory);
  return readdirSync(absolute)
    .filter((name) => predicate(name))
    .sort()
    .map((name) => readFileSync(resolve(absolute, name), "utf8"));
}

export function collectRepositoryDeploySurface(root) {
  return [
    readFileSync(resolve(root, "package.json"), "utf8"),
    ...readTextFiles(
      root,
      "scripts",
      (name) => name.endsWith(".mjs") && !name.endsWith(".test.mjs") && name !== "cf-ci-gates.mjs",
    ),
  ].join("\n");
}

export function assertRepositoryCfCiGates(root) {
  const namingSources = Object.fromEntries(
    NAMING_DOC_RELS.map((rel) => [rel, readFileSync(resolve(root, rel), "utf8")]),
  );
  const issues = assertCfCiGates({
    wranglerSource: readFileSync(resolve(root, WRANGLER_CONFIG_REL), "utf8"),
    ciYml: readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"),
    deliveryYml: readFileSync(resolve(root, ".delivery.yml"), "utf8"),
    webPackageSource: readFileSync(resolve(root, "web/package.json"), "utf8"),
    runtimeConfigSource: readFileSync(resolve(root, "web/lib/runtime-config.ts"), "utf8"),
    deploySurfaceSource: collectRepositoryDeploySurface(root),
    namingSources,
  });
  if (issues.length > 0) {
    throw new Error(`CF CI gates failed:\n- ${issues.join("\n- ")}`);
  }
  return {
    productionWorker: PRODUCTION_WORKER_NAME,
    previewWorker: PREVIEW_WORKER_NAME,
    previewEnv: PREVIEW_WRANGLER_ENV,
    previewOrigin: DEFAULT_CF_PREVIEW_ORIGIN,
    productionCrons: [],
    assertScript: ASSERT_SCRIPT_REL,
  };
}

const thisPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && resolve(thisPath) === entryPath) {
  try {
    const summary = assertRepositoryCfCiGates(resolve(dirname(thisPath), ".."));
    console.log(
      `CF CI gates ok: ${summary.previewEnv}→${summary.previewWorker}; probe ${summary.previewOrigin}; production ${summary.productionWorker} triggers.crons=[]; no live deploy`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
