import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planCfWranglerDryRun } from "./cf-ci-gates.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(repoRoot, "web");

const plan = planCfWranglerDryRun(process.argv.slice(2));
console.log(
  `cf:dry-run targeting wrangler env ${plan.wranglerEnv} (Worker ${plan.workerName}); --dry-run required; never live-deploys gitstarclub-web`,
);

const result = spawnSync("bunx", ["wrangler", ...plan.argv], {
  cwd: webRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
