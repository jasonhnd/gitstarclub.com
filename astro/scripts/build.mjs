import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { contentSecurityPolicyForEnvironment, securityHeaders } from "../../web/lib/csp.ts";

const mode = process.argv[process.argv.indexOf("--mode") + 1];
if (!["pre", "production"].includes(mode)) throw new Error("--mode pre or production required");
const scratch = process.env.KANBAN_TMP;
if (!scratch) throw new Error("Set card-local KANBAN_TMP and TMPDIR");
const env = { ...process.env, GSC_HOST_MODE: mode };
for (const args of [["scripts/prepare-local.mjs"], ["node_modules/astro/bin/astro.mjs", "build", "--mode", mode]]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const headersPath = resolve(scratch, "astro-cloudflare/output/v0/workers/default/assets/_headers");
const headers = securityHeaders.map(({ key, value }) => `  ${key}: ${key === "Content-Security-Policy" ? contentSecurityPolicyForEnvironment("production") : value}`).join("\n");
writeFileSync(headersPath, `${readFileSync(headersPath, "utf8").trimEnd()}\n\n/*\n${headers}\n`);
writeFileSync(resolve(scratch, "astro-host-build.json"), JSON.stringify({
  mode, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  fixture: Boolean(process.env.GSC_FIXTURE_ORIGIN || process.env.BLOB_BASE_URL),
}, null, 2) + "\n");
