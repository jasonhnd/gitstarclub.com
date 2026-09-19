import { readFileSync } from "node:fs";
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

const LEGACY_PREVIEW_WORKER_NAME = "gitstarclub-web-nonprod";
const WRANGLER_CONFIG_REL = "workers/gitstarclub-web/wrangler.jsonc";

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

export function findWranglerDeployInvocations(text) {
  const invocations = [];
  for (const rawLine of text.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;
    const match = trimmed.match(/wrangler\s+deploy\b(.*)/);
    if (!match) continue;
    const command = `wrangler deploy${match[1] ?? ""}`;
    invocations.push({
      command,
      hasDryRun: /--dry-run(?:\s|=|$)/.test(command),
    });
  }
  return invocations;
}

function ciPreviewOriginFallback(ciYml) {
  const match = ciYml.match(/CF_PREVIEW_ORIGIN:\s*\$\{\{\s*vars\.CF_PREVIEW_ORIGIN\s*\|\|\s*'([^']+)'\s*\}\}/);
  return match?.[1] ?? null;
}

function isAllowedPreviewOrigin(origin) {
  const normalized = origin.replace(/\/+$/, "");
  return ALLOWED_CF_PREVIEW_ORIGINS.includes(normalized);
}

function jobMentionsPreAllowlist(ciYml, jobId) {
  const start = ciYml.indexOf(`  ${jobId}:`);
  if (start === -1) return false;
  const next = ciYml.slice(start + 1).search(/\n  [a-z0-9-]+:/i);
  const block = next === -1 ? ciYml.slice(start) : ciYml.slice(start, start + 1 + next);
  return block.includes("github.ref_name == 'pre'") && block.includes("github.base_ref == 'pre'");
}

/**
 * @typedef {object} CfCiGateSources
 * @property {string} wranglerSource
 * @property {string} ciYml
 * @property {string} deliveryYml
 * @property {string} webPackageSource
 * @property {string} runtimeConfigSource
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
  if (!preview) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV} is required`);
  } else if (preview.name !== PREVIEW_WORKER_NAME) {
    issues.push(`wrangler env.${PREVIEW_WRANGLER_ENV}.name must be ${PREVIEW_WORKER_NAME}`);
  }

  const productionCrons = wrangler.triggers?.crons;
  if (productionCrons !== undefined && (!Array.isArray(productionCrons) || productionCrons.length > 0)) {
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

  for (const { command, hasDryRun } of findWranglerDeployInvocations(`${ciYml}\n${webPackageSource}`)) {
    if (!hasDryRun) {
      issues.push(`refusing bare wrangler deploy (missing --dry-run): ${command.trim()}`);
    }
  }

  if (webPackageSource.includes(`--env ""`) || webPackageSource.includes("--env ''")) {
    issues.push('web/package.json must not use wrangler --env "" (top-level name is production gitstarclub-web)');
  }

  if (!webPackageSource.includes("scripts/cf-wrangler-dry-run.mjs") && !webPackageSource.includes("cf-wrangler-dry-run")) {
    issues.push("web/package.json cf:dry-run must go through scripts/cf-wrangler-dry-run.mjs");
  }

  if (!/cf-preview[\s\S]*MUST NOT be added/.test(deliveryYml) && !deliveryYml.includes("MUST NOT be added")) {
    issues.push(".delivery.yml must keep cf-preview / cf-workers-host out of required checks");
  }
  const checksMatch = deliveryYml.match(/checks:\s*\[([^\]]+)\]/);
  const requiredChecks = checksMatch?.[1] ?? "";
  if (/\bcf-preview\b/.test(requiredChecks) || /\bcf-workers-host\b/.test(requiredChecks)) {
    issues.push(".delivery.yml ci.checks must not require cf-preview or cf-workers-host");
  }

  for (const jobId of ["cf-preview", "cf-workers-host"]) {
    if (!jobMentionsPreAllowlist(ciYml, jobId)) {
      issues.push(`${jobId} must allowlist only github.ref_name == 'pre' or github.base_ref == 'pre'`);
    }
  }

  return issues;
}

export function assertRepositoryCfCiGates(root) {
  const issues = assertCfCiGates({
    wranglerSource: readFileSync(resolve(root, WRANGLER_CONFIG_REL), "utf8"),
    ciYml: readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"),
    deliveryYml: readFileSync(resolve(root, ".delivery.yml"), "utf8"),
    webPackageSource: readFileSync(resolve(root, "web/package.json"), "utf8"),
    runtimeConfigSource: readFileSync(resolve(root, "web/lib/runtime-config.ts"), "utf8"),
  });
  if (issues.length > 0) {
    throw new Error(`CF CI gates failed:\n- ${issues.join("\n- ")}`);
  }
  return {
    productionWorker: PRODUCTION_WORKER_NAME,
    previewWorker: PREVIEW_WORKER_NAME,
    previewEnv: PREVIEW_WRANGLER_ENV,
    previewOrigin: DEFAULT_CF_PREVIEW_ORIGIN,
  };
}

const invokedPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
const thisPath = fileURLToPath(import.meta.url);
if (invokedPath && resolve(invokedPath) === resolve(thisPath) && process.argv[1]?.endsWith("cf-ci-gates.mjs")) {
  try {
    const summary = assertRepositoryCfCiGates(resolve(dirname(thisPath), ".."));
    console.log(
      `CF CI gates ok: ${summary.previewEnv}→${summary.previewWorker}; probe ${summary.previewOrigin}; no live deploy to ${summary.productionWorker}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
