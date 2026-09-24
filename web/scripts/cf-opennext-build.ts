/// <reference types="bun" />

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  const patched = patchOpentelemetryApiPackageJsonFiles();
  for (const path of patched) {
    console.log(`patched @opentelemetry/api package.json for OpenNext: ${path}`);
  }

  const preview = process.argv.includes("--site-target=pre");
  const result = Bun.spawnSync({
    cmd: [
      "bunx",
      "opennextjs-cloudflare",
      "build",
      "--config",
      "../workers/gitstarclub-web/wrangler.jsonc",
      ...process.argv.slice(2).filter((arg) => arg !== "--site-target=pre"),
    ],
    cwd: WEB_ROOT,
    env: preview
      ? { ...process.env, SITE_INDEXABLE: "0" }
      : { ...process.env, SITE_INDEXABLE: "1", NEXT_PUBLIC_SITE_URL: "https://gitstarclub.com" },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  process.exit(result.exitCode ?? 1);
}

if (import.meta.main) await main();
