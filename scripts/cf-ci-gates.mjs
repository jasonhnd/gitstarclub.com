import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const PRODUCTION_WORKER_NAME = "gitstarclub-web";
export const PREVIEW_WORKER_NAME = "gitstarclub-web-pre";
export const DEFAULT_CF_PREVIEW_ORIGIN = "https://gitstarclub-web-pre.worldgo.workers.dev";
export const ALLOWED_CF_PREVIEW_ORIGINS = Object.freeze([DEFAULT_CF_PREVIEW_ORIGIN, "https://pre.gitstarclub.com"]);
export const PREVIEW_CRONS_PAUSED = true;
export const PREVIEW_CRON_TRIGGERS = Object.freeze(["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]);
export const ASSERT_SCRIPT_REL = "scripts/assert-cf-ci-gates.mjs";

export function assertAllowedCfPreviewOrigin(value = DEFAULT_CF_PREVIEW_ORIGIN) {
  const url = new URL(value);
  if (!ALLOWED_CF_PREVIEW_ORIGINS.includes(url.origin) || url.href !== `${url.origin}/`) {
    throw new Error("CF preview origin is not allowlisted");
  }
  return url.origin;
}

/** Validate evaluated typed configuration, never a textual approximation of bindings. */
export function assertHostContract(worker, mode) {
  const errors = [];
  const pre = mode === "pre";
  const name = pre ? PREVIEW_WORKER_NAME : PRODUCTION_WORKER_NAME;
  const bucket = pre ? "gitstarclub-data-pre" : "gitstarclub-data-prod";
  const queue = pre ? "gitstarclub-jobs-pre" : "gitstarclub-jobs";
  const site = pre ? "https://pre.gitstarclub.com" : "https://gitstarclub.com";
  const vars = {
    HOSTING_TARGET: "cf", SITE_INDEXABLE: pre ? "0" : "1", NEXT_PUBLIC_SITE_URL: "https://gitstarclub.com",
    CF_CRON_ORIGIN: site, DEPLOY_ENV: mode, STORAGE_READ_DRIVER: "r2", STORAGE_WRITE_DRIVER: "r2_binding",
    R2_BUCKET: bucket, R2_PUBLIC_BASE_URL: pre ? "https://data-pre.gitstarclub.com" : "https://data.gitstarclub.com",
    WORKFLOW_RUNTIME: "cf-queue", WORKFLOW_QUEUE_ENQUEUE_URL: `${site}/enqueue`,
    ...(pre ? { MIN_TRACKED_STARS: "10000", WHITELIST_SEARCH_SHARDS: "1", WORKFLOW_COLD_START: "1", PREFLIGHT_RELAX_EMPTY_SHARDS: "1" }
      : { VIEWS_VERSION_FALLBACK: "refresh-2026-09-13T06-00-16-398Z" }),
  };
  const check = (condition, message) => { if (!condition) errors.push(`${mode}: ${message}`); };
  check(worker.name === name, "Worker name");
  check(worker.entrypoint === "../workers/gitstarclub-web/src/index.ts", "custom entrypoint");
  check(worker.compatibilityDate === "2026-09-17", "compatibility date");
  check(JSON.stringify(worker.compatibilityFlags) === JSON.stringify(["nodejs_compat", "global_fetch_strictly_public"]), "compatibility flags");
  check(worker.observability?.enabled === true, "observability");
  check(worker.workersDev === pre && worker.previewUrls === pre, "public endpoint policy");
  check(!worker.routes && !worker.domains && !worker.exports, "no routes, domains or database exports");
  check(worker.assets?.htmlHandling === "none" && worker.assets?.notFoundHandling === "none", "asset handling");
  check(JSON.stringify(worker.assets?.runWorkerFirst) === JSON.stringify(["/*", "!/_next/static/*", "!/*/_next/static/*", "!/assets/*"]), "Worker-first private assets");
  check(JSON.stringify(worker.triggers) === JSON.stringify([{ type: "queue", name: queue, maxBatchSize: 1, maxRetries: 2 }]), "queue consumer and paused schedules");
  const env = worker.env ?? {};
  for (const [key, value] of Object.entries(vars)) check(env[key]?.type === "text" && env[key]?.value === value, `var ${key}`);
  for (const [key, expected] of Object.entries({
    ASSETS: { type: "assets" }, DATA: { type: "r2", name: bucket }, MEDIA: { type: "r2", name: "gitstarclub-assets" },
    JOBS: { type: "queue", name: queue }, WORKER_SELF_REFERENCE: { type: "worker", worker: name }, GSC_CACHE: { type: "kv" },
  })) check(JSON.stringify(env[key]) === JSON.stringify(expected), `binding ${key}`);
  const extra = Object.keys(env).filter((key) => !(key in vars) && !["ASSETS", "DATA", "MEDIA", "JOBS", "WORKER_SELF_REFERENCE", "GSC_CACHE"].includes(key));
  check(extra.length === 0, `undeclared bindings/vars ${extra.join(",")}`);
  return errors;
}

/** Only the explicit owner-run preview script may select deployment. */
export function commandPolicy(scripts, ciSource) {
  const errors = [];
  const legacy = /wran[g]ler|opennextjs-cloudflare|@opennextjs\/cloudflare|cf:(?:build|dry-run|preview)/i;
  for (const [name, command] of Object.entries(scripts)) {
    if (legacy.test(String(command))) errors.push(`Forbidden legacy command: ${name}`);
    if (/\bdeploy\b|versions\s+upload|schedules\s+(?:put|update|create)|triggers\s+deploy|\b(?:cf|cloudflare|vinext-cloudflare)\s+(?!(?:cli\s+(?:search|list)|workers\s+types)\b)|api\.cloudflare\.com/.test(String(command))
      && !(name === "deploy:pre" && command === "vinext-cloudflare deploy --env pre")) errors.push(`Forbidden mutation: ${name}`);
  }
  if (legacy.test(ciSource)) errors.push("CI contains a legacy platform command");
  if (/\b(?:cf|cloudflare|vinext-cloudflare)\s+(?!(?:cli\s+(?:search|list)|workers\s+types)\b)|api\.cloudflare\.com/.test(ciSource)) errors.push("CI must never deploy or mutate Cloudflare");
  for (const mode of ["pre", "production"]) {
    if (scripts[`build:${mode}`] !== `vite build --mode ${mode}`) errors.push(`Missing explicit ${mode} build`);
  }
  if (scripts.build !== "vite build --mode production") errors.push("Default build must select production");
  if (scripts["deploy:pre"] !== "vinext-cloudflare deploy --env pre") errors.push("Preview deploy must use typed cf path");
  return errors;
}

export async function assertRepositoryCfCiGates(root) {
  const { hostWorker } = await import(pathToFileURL(resolve(root, "web/cloudflare.config.ts")).href);
  const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const delivery = readFileSync(resolve(root, ".delivery.yml"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(root, "web/package.json"), "utf8"));
  const errors = ["pre", "production"].flatMap((mode) => assertHostContract(hostWorker(mode), mode));
  errors.push(...commandPolicy(pkg.scripts, ci));
  if (!/checks:\s*\[static, production-build\]/.test(delivery)) errors.push("Required checks must remain static and production-build");
  for (const job of ["static", "production-build"]) if (!ci.includes(`  ${job}:`)) errors.push(`Missing job ${job}`);
  for (const file of readdirSync(resolve(root, ".github/workflows"))) {
    if (!/\.ya?ml$/.test(file) || file === "ci.yml") continue;
    const source = readFileSync(resolve(root, ".github/workflows", file), "utf8");
    if (/wran[g]ler|opennextjs-cloudflare|\b(?:cf|vinext-cloudflare)\s+deploy/i.test(source)) errors.push(`Forbidden platform command in ${file}`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return { previewEnv: "pre", previewWorker: PREVIEW_WORKER_NAME, previewOrigin: DEFAULT_CF_PREVIEW_ORIGIN, productionWorker: PRODUCTION_WORKER_NAME };
}
