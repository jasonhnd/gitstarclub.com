/// <reference types="bun" />

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeCfBuildIdentity } from "./cf-build-identity";
import { rewriteOpentelemetryApiPackageJson } from "../lib/workers-host/opentelemetry-api-package";

const WEB_ROOT = join(import.meta.dir, "..");
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

async function main(): Promise<void> {
  const targetArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--site-target"));
  if (targetArgs.length !== 1 || !["--site-target=production", "--site-target=pre"].includes(targetArgs[0])) {
    throw new Error("cf:build requires exactly one --site-target=production or --site-target=pre");
  }
  const preview = targetArgs[0] === "--site-target=pre";
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
