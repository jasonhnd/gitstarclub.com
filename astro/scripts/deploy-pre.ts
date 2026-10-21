import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Owner-run only after separate deployment authorization. Never called by builds/CI.
const scratch = process.env.KANBAN_TMP;
assert(scratch, "Set KANBAN_TMP to the reviewed build directory");
const stamp = JSON.parse(readFileSync(resolve(scratch, "astro-host-build.json"), "utf8"));
assert.equal(stamp.mode, "pre", "only a pre artifact may be deployed");
assert.equal(stamp.fixture, false, "fixture builds must never be deployed");
assert.equal(stamp.commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "", "clean reviewed checkout required");
const config = JSON.parse(readFileSync(resolve(scratch, "astro-cloudflare/output/v0/workers/default/worker.config.json"), "utf8"));
assert.equal(config.name, "gitstarclub-web-pre");
assert(config.triggers.every((trigger: { type: string }) => trigger.type === "queue"));
for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"]) assert(!config.env[key], "no local fixture bindings");
assert.equal(config.env.R2_PUBLIC_BASE_URL.value, "https://data-pre.gitstarclub.com");
assert.equal(config.env.STORAGE_READ_DRIVER.value, "r2");
const check = Bun.spawn(["bun", "scripts/validate-host.ts", "--mode", "pre"], { stdout: "inherit", stderr: "inherit" });
assert.equal(await check.exited, 0, "validate the reviewed artifact before deployment");
const cli = resolve("node_modules/cf/bin/cf");
assert.equal(JSON.parse(readFileSync("node_modules/cf/package.json", "utf8")).version, "1.0.0-beta.18");
const child = Bun.spawn(["node", cli, "deploy", "--prebuilt", "--mode", "pre", "--no-provision"], { stdout: "inherit", stderr: "inherit" });
process.exitCode = await child.exited;
