/// <reference types="bun" />

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeCfBuildIdentity } from "./cf-build-identity";
import { rewriteOpentelemetryApiPackageJson } from "../lib/workers-host/opentelemetry-api-package";

const WEB_ROOT = join(import.meta.dir, "..");
const WRANGLER_CONFIG_PATH = join(WEB_ROOT, "../workers/gitstarclub-web/wrangler.jsonc");
const PUBLIC_READ_BASE_ENV_KEYS = [
  "R2_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_R2_PUBLIC_BASE_URL",
  "BLOB_BASE_URL",
  "NEXT_PUBLIC_BLOB_BASE_URL",
] as const;

export type SiteBuildTarget = "production" | "pre";

export type WranglerPublicReadConfig = {
  vars?: Record<string, string | undefined>;
  env?: { pre?: { vars?: Record<string, string | undefined> } };
};

const OTEL_PACKAGE_PATHS = [
  join(WEB_ROOT, "node_modules/@opentelemetry/api/package.json"),
  join(WEB_ROOT, ".next/standalone/node_modules/@opentelemetry/api/package.json"),
] as const;

export function patchOpentelemetryApiPackageJsonFiles(paths: readonly string[] = OTEL_PACKAGE_PATHS): string[] {
  const patched: string[] = [];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const next = rewriteOpentelemetryApiPackageJson(readFileSync(path, "utf8"));
    writeFileSync(path, next);
    patched.push(path);
  }
  return patched;
}

function stripJsonc(source: string): string {
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

function normalizePublicReadBase(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

/**
 * Loopback is the CI and AGENTS.md read-only fixture, not a preview or production store.
 * The URL hostname for IPv6 keeps its brackets, so `[::1]` is loopback.
 */
export function isLocalPublicReadFixture(value: string): boolean {
  try {
    const url = new URL(value);
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return bare === "127.0.0.1" || bare === "localhost" || bare === "::1";
}

function varsForTarget(
  wrangler: WranglerPublicReadConfig,
  target: SiteBuildTarget,
): Record<string, string | undefined> {
  if (target === "pre") return wrangler.env?.pre?.vars ?? {};
  return wrangler.vars ?? {};
}

function declaredPublicReadBases(vars: Record<string, string | undefined>): Map<string, string> {
  const declared = new Map<string, string>();
  for (const key of PUBLIC_READ_BASE_ENV_KEYS) {
    const value = normalizePublicReadBase(vars[key]);
    if (value) declared.set(key, value);
  }
  return declared;
}

/**
 * Compare the shell's public read base with the wrangler vars for the build
 * target. A mismatch bakes the other environment's data into prerendered pages.
 * An empty shell value is ignored. A loopback fixture is ignored.
 */
export function publicReadBaseMismatches(input: {
  target: SiteBuildTarget;
  shell: Record<string, string | undefined>;
  wrangler: WranglerPublicReadConfig;
}): string[] {
  const targetDeclared = declaredPublicReadBases(varsForTarget(input.wrangler, input.target));
  const otherTarget: SiteBuildTarget = input.target === "pre" ? "production" : "pre";
  const otherDeclared = declaredPublicReadBases(varsForTarget(input.wrangler, otherTarget));
  const otherValues = new Set(otherDeclared.values());
  const issues: string[] = [];
  // OpenNext inherits the shell, not wrangler's read-driver vars, during
  // prerender. Stage 4 must explicitly export the R2 driver and public base.
  const stage4 = input.target === "production" && varsForTarget(input.wrangler, input.target).DEPLOY_ENV === "production";
  if (stage4) {
    if (input.shell.STORAGE_READ_DRIVER !== "r2") {
      issues.push("cf:build stage-4 production requires shell STORAGE_READ_DRIVER=r2");
    }
    if (!normalizePublicReadBase(input.shell.R2_PUBLIC_BASE_URL)) {
      issues.push("cf:build stage-4 production requires shell R2_PUBLIC_BASE_URL");
    }
    if (Object.keys(input.shell).some((key) => key.includes("BLOB_") && input.shell[key] !== undefined)) {
      issues.push("cf:build stage-4 production refuses shell BLOB_* variables");
    }
    if (input.shell.READ_DRIVER !== undefined && input.shell.READ_DRIVER !== "r2") {
      issues.push("cf:build stage-4 production refuses a conflicting shell READ_DRIVER");
    }
  }
  for (const key of PUBLIC_READ_BASE_ENV_KEYS) {
    const shellValue = normalizePublicReadBase(input.shell[key]);
    if (!shellValue || isLocalPublicReadFixture(shellValue)) continue;
    const declared = targetDeclared.get(key);
    if (otherValues.has(shellValue) && shellValue !== declared) {
      issues.push(
        `cf:build --site-target=${input.target} refuses ${key}=${shellValue}: that public read base belongs to ${otherTarget}`,
      );
      continue;
    }
    if (!declared) {
      issues.push(
        `cf:build --site-target=${input.target} refuses ${key}=${shellValue}: wrangler ${input.target} does not declare ${key}`,
      );
      continue;
    }
    if (shellValue !== declared) {
      issues.push(
        `cf:build --site-target=${input.target} refuses ${key}=${shellValue}: wrangler ${input.target} declares ${key}=${declared}`,
      );
    }
  }
  return issues;
}

export function assertBuildPublicReadBase(input: {
  target: SiteBuildTarget;
  shell: Record<string, string | undefined>;
  wrangler: WranglerPublicReadConfig;
}): void {
  const issues = publicReadBaseMismatches(input);
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
}

function loadWranglerPublicReadConfig(): WranglerPublicReadConfig {
  return JSON.parse(stripJsonc(readFileSync(WRANGLER_CONFIG_PATH, "utf8"))) as WranglerPublicReadConfig;
}

async function main(): Promise<void> {
  const targetArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--site-target"));
  if (targetArgs.length !== 1 || !["--site-target=production", "--site-target=pre"].includes(targetArgs[0])) {
    throw new Error("cf:build requires exactly one --site-target=production or --site-target=pre");
  }
  const preview = targetArgs[0] === "--site-target=pre";
  assertBuildPublicReadBase({
    target: preview ? "pre" : "production",
    shell: process.env,
    wrangler: loadWranglerPublicReadConfig(),
  });
  console.log(`CF build identity: ${writeCfBuildIdentity() ?? "null"}`);
  const patched = patchOpentelemetryApiPackageJsonFiles();
  for (const path of patched) {
    console.log(`patched @opentelemetry/api package.json for OpenNext: ${path}`);
  }

  const result = Bun.spawnSync({
    cmd: [
      "bunx",
      "opennextjs-cloudflare",
      "build",
      "--config",
      "../workers/gitstarclub-web/wrangler.jsonc",
      ...process.argv.slice(2).filter((arg) => !arg.startsWith("--site-target")),
    ],
    cwd: WEB_ROOT,
    env: preview
      ? { ...process.env, SITE_INDEXABLE: "0" }
      : { ...process.env, SITE_INDEXABLE: "1", NEXT_PUBLIC_SITE_URL: "https://gitstarclub.com" },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);

  // Next's prerendered home and robots responses are the inputs OpenNext packages.
  const home = readFileSync(join(WEB_ROOT, ".next/server/app/index.html"), "utf8");
  const robots = readFileSync(join(WEB_ROOT, ".next/server/app/robots.txt.body"), "utf8");
  const generalRobots = robots.match(/^User-Agent: \*\s*\n([^]*?)(?=\n\s*User-Agent:|\n\s*Host:|\n\s*Sitemap:|$)/m)?.[1] ?? "";
  if (preview) {
    if (!/name="robots" content="noindex, nofollow"/.test(home) || !/^Disallow: \/$/m.test(generalRobots)) {
      throw new Error("cf:build pre output must contain noindex and robots Disallow: /");
    }
  } else if (!/name="robots" content="index, follow"/.test(home) || /name="robots" content="[^"]*noindex/i.test(home) || !/^Allow: \/$/m.test(generalRobots) || /^Disallow: \/$/m.test(generalRobots)) {
    throw new Error("cf:build production output must be indexable");
  }
  console.log(`cf:build ${preview ? "pre" : "production"} indexing self-check passed`);
}

if (import.meta.main) await main();
