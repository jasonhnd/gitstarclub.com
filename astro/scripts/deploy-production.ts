import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { assertProductionArtifact } from "./production-deploy-guards";
import { preparePrebuiltDeploy } from "./prebuilt-deploy";

// Owner-run only after separate deployment authorization. Never called by builds/CI.
const scratch = process.env.KANBAN_TMP;
assert(scratch, "Set KANBAN_TMP to the reviewed build directory");
assertProductionArtifact(scratch);
const check = Bun.spawn(["bun", "scripts/validate-host.ts", "--mode", "production"], { stdout: "inherit", stderr: "inherit" });
assert.equal(await check.exited, 0, "validate the reviewed artifact before deployment");
assertProductionArtifact(scratch);
const cli = resolve("node_modules/cf/bin/cf");
assert.equal(JSON.parse(readFileSync("node_modules/cf/package.json", "utf8")).version, "1.0.0-beta.18");
const deployment = preparePrebuiltDeploy(scratch, cli, "production");
try {
  const child = Bun.spawn(deployment.cmd, { cwd: deployment.cwd, stdout: "inherit", stderr: "inherit" });
  process.exitCode = await child.exited;
} finally {
  rmSync(deployment.cwd, { recursive: true, force: true });
}
