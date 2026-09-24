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
// Repo draft stays Vercel-parity (Sunday=0). Dispatch also accepts CF 7 / SUN.
export const PREVIEW_CRON_TRIGGERS = Object.freeze(["0 3 * * *", "0 4 * * 0", "0 6 * * 0"]);
export const PREVIEW_MIN_TRACKED_STARS = "1000";
export const PRODUCTION_MIN_TRACKED_STARS = "10000";
export const PREVIEW_PREFLIGHT_RELAX_EMPTY_SHARDS = "1";
export const PREVIEW_WORKFLOW_COLD_START = "1";
export const PREVIEW_BLOB_BASE_URL =
  "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com";
export const PREVIEW_QUEUE_NAME = "gitstarclub-jobs-pre";
export const PREVIEW_WORKFLOW_RUNTIME = "cf-queue";
export const PREVIEW_WORKFLOW_QUEUE_ENQUEUE_URL = "https://pre.gitstarclub.com/enqueue";
export const ASSERT_SCRIPT_REL = "scripts/assert-cf-ci-gates.mjs";

const LEGACY_PREVIEW_WORKER_NAME = "gitstarclub-web-nonprod";
const WRANGLER_CONFIG_REL = "workers/gitstarclub-web/wrangler.jsonc";
const NAMING_DOC_RELS = Object.freeze(["docs/OPS.md", "docs/TESTING.md", "docs/README.md"]);

export function stripJsonc(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      let inString = false;
      let escaped = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString && char === "/" && line[index + 1] === "/") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");
}

export function parseWranglerJsonc(source) {
  return JSON.parse(stripJsonc(source));
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

/**
 * @typedef {object} CfCiGateSources
 * @property {string} wranglerSource
 * @property {string} ciYml
 * @property {string} deliveryYml
 * @property {string} webPackageSource
 * @property {string} runtimeConfigSource
 * @property {string} [deploySurfaceSource]
 * @property {Record<string, string>} [namingSources]
 */

/**
 * @param {CfCiGateSources} sources
 * @returns {string[]}
 */
export function assertCfCiGates(sources) {
  const { wranglerSource, ciYml, deliveryYml, webPackageSource, runtimeConfigSource } = sources;
  const issues = [];
  const wrangler = parseWranglerJsonc(wranglerSource);
  if (wrangler.name !== PRODUCTION_WORKER_NAME) {
    issues.push(`wrangler top-level name must be ${PRODUCTION_WORKER_NAME} (production)`);
  }
  if (wrangler.env?.nonprod) {
    issues.push("wrangler env.nonprod is retired; preview lives under env.pre as gitstarclub-web-pre");
  }
  if (JSON.stringify(wrangler).includes(LEGACY_PREVIEW_WORKER_NAME)) {
    issues.push(`wrangler must not name a Worker ${LEGACY_PREVIEW_WORKER_NAME}`);
  }
  const preview = wrangler.env?.[PREVIEW_WRANGLER_ENV];
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

  const productionCrons = wrangler.triggers?.crons;
  if (!productionCronsAreEmpty(productionCrons)) {
    issues.push("wrangler top-level triggers.crons must stay [] until Jason approves production CF Cron");
  }
  const previewCrons = preview?.triggers?.crons;
  if (previewCrons !== undefined && JSON.stringify(previewCrons) !== JSON.stringify([...PREVIEW_CRON_TRIGGERS])) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} triggers.crons must be the three Vercel-parity expressions ${JSON.stringify(
        [...PREVIEW_CRON_TRIGGERS],
      )} (repo draft only; platform enable is ops)`,
    );
  }
  const productionOrigin = wrangler.vars?.CF_CRON_ORIGIN;
  if (productionOrigin !== undefined && productionOrigin !== PRODUCTION_CRON_ORIGIN) {
    issues.push(`wrangler top-level vars.CF_CRON_ORIGIN must be ${PRODUCTION_CRON_ORIGIN} when set`);
  }
  const previewOriginVar = preview?.vars?.CF_CRON_ORIGIN;
  if (previewOriginVar !== undefined && previewOriginVar !== PREVIEW_CRON_ORIGIN) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} vars.CF_CRON_ORIGIN must be ${PREVIEW_CRON_ORIGIN} when set`);
  }
  const previewMinTracked = preview?.vars?.MIN_TRACKED_STARS;
  if (previewMinTracked !== PREVIEW_MIN_TRACKED_STARS) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.MIN_TRACKED_STARS must be ${PREVIEW_MIN_TRACKED_STARS} (Jason 2026-09-21 ≥1k on pre)`,
    );
  }
  const productionMinTracked = wrangler.vars?.MIN_TRACKED_STARS;
  if (productionMinTracked !== undefined && productionMinTracked !== PRODUCTION_MIN_TRACKED_STARS) {
    issues.push(
      `wrangler top-level vars.MIN_TRACKED_STARS must be unset or ${PRODUCTION_MIN_TRACKED_STARS} (production stays ≥10k)`,
    );
  }
  const previewRelaxEmpty = preview?.vars?.PREFLIGHT_RELAX_EMPTY_SHARDS;
  if (previewRelaxEmpty !== undefined && previewRelaxEmpty !== PREVIEW_PREFLIGHT_RELAX_EMPTY_SHARDS) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.PREFLIGHT_RELAX_EMPTY_SHARDS must be unset or ${PREVIEW_PREFLIGHT_RELAX_EMPTY_SHARDS} (preview-only empty-shard placeholder)`,
    );
  }
  const productionRelaxEmpty = wrangler.vars?.PREFLIGHT_RELAX_EMPTY_SHARDS;
  if (productionRelaxEmpty === PREVIEW_PREFLIGHT_RELAX_EMPTY_SHARDS) {
    issues.push(
      "wrangler top-level vars.PREFLIGHT_RELAX_EMPTY_SHARDS must not be 1 (preview-only; production stays fail-closed)",
    );
  }
  const previewColdStart = preview?.vars?.WORKFLOW_COLD_START;
  if (previewColdStart !== PREVIEW_WORKFLOW_COLD_START) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.WORKFLOW_COLD_START must be ${PREVIEW_WORKFLOW_COLD_START} (preview-only first-universe bootstrap)`,
    );
  }
  const productionColdStart = wrangler.vars?.WORKFLOW_COLD_START;
  if (productionColdStart === PREVIEW_WORKFLOW_COLD_START) {
    issues.push(
      "wrangler top-level vars.WORKFLOW_COLD_START must not be 1 (preview-only; production stays fail-closed)",
    );
  }
  const previewBlobBase = preview?.vars?.BLOB_BASE_URL;
  if (previewBlobBase !== PREVIEW_BLOB_BASE_URL) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.BLOB_BASE_URL must be the public preview store base (${PREVIEW_BLOB_BASE_URL})`,
    );
  }
  const previewPublicBlobBase = preview?.vars?.NEXT_PUBLIC_BLOB_BASE_URL;
  if (previewPublicBlobBase !== PREVIEW_BLOB_BASE_URL) {
    issues.push(
      `wrangler env.${PREVIEW_WRANGLER_ENV} vars.NEXT_PUBLIC_BLOB_BASE_URL must match BLOB_BASE_URL (${PREVIEW_BLOB_BASE_URL})`,
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
  const productionBlobBase = wrangler.vars?.BLOB_BASE_URL;
  if (productionBlobBase !== undefined) {
    issues.push("wrangler top-level vars.BLOB_BASE_URL must stay unset (preview-only plaintext binding)");
  }
  const productionWorkflowRuntime = wrangler.vars?.WORKFLOW_RUNTIME;
  if (productionWorkflowRuntime === PREVIEW_WORKFLOW_RUNTIME) {
    issues.push("wrangler top-level vars.WORKFLOW_RUNTIME must not be cf-queue (preview-only)");
  }

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

  const extraSurface = sources.deploySurfaceSource ?? "";
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
