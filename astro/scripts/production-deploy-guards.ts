import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type BuildStamp = { mode?: unknown; fixture?: unknown; commit?: unknown };
type Binding = { type: string; value?: string; name?: string; id?: string };
export type ProductionConfig = {
  name: string;
  env: Record<string, Binding>;
  triggers: { type: string; name?: string; schedule?: string }[];
  routes?: unknown;
  domains?: unknown;
};

/** Pure guards are safe to import from tests and artifact-only verification. */
export function assertProductionBuild(stamp: BuildStamp, commit: string, status: string) {
  assert.equal(stamp.mode, "production", "only a production artifact may be deployed");
  assert.equal(stamp.fixture, false, "fixture builds must never be deployed");
  assert.equal(stamp.commit, commit, "rebuild the exact current commit");
  assert.equal(status.trim(), "", "clean reviewed checkout required");
}

export function assertProductionConfig(config: ProductionConfig) {
  assert.equal(config.name, "gitstarclub-web", "production Worker required");
  assert(!config.routes && !config.domains, "production must not declare routes or domains");
  assert.equal(config.triggers.length, 1, "exactly one production queue and no schedules required");
  assert.equal(config.triggers[0].type, "queue", "production queue trigger required; no schedules or routes");
  assert.equal(config.triggers[0].name, "gitstarclub-jobs", "production queue required");
  const env = config.env;
  assert.deepEqual(env.DATA, { type: "r2", name: "gitstarclub-data-prod" }, "production DATA binding required");
  assert.deepEqual(env.JOBS, { type: "queue", name: "gitstarclub-jobs" }, "production JOBS binding required");
  for (const [key, value] of Object.entries({
    DEPLOY_ENV: "production", R2_BUCKET: "gitstarclub-data-prod",
    R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com", STORAGE_READ_DRIVER: "r2",
    STORAGE_WRITE_DRIVER: "r2_binding", SITE_INDEXABLE: "1",
  })) assert.deepEqual(env[key], { type: "text", value }, `production ${key} required`);
  for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "WORKFLOW_FIXTURE"]) {
    assert(!Object.hasOwn(env, key), "no Blob or fixture bindings allowed");
  }
  assert.equal(env.GSC_CACHE?.type, "kv", "existing production GSC_CACHE KV binding required");
  assert.match(env.GSC_CACHE.id ?? "", /^[a-f0-9]{32}$/, "resolve and pin the existing production GSC_CACHE KV id; never create one");
  assert.notEqual(env.GSC_CACHE.id, "4c3107414bad4a0386fedfcf96dde6e2", "production must not use preview KV");
}

/** Read only local build output and Git state; never calls cf or deploys. */
export function assertProductionArtifact(scratch: string) {
  const stamp = JSON.parse(readFileSync(resolve(scratch, "astro-host-build.json"), "utf8"));
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  assertProductionBuild(stamp, git(["rev-parse", "HEAD"]), git(["status", "--porcelain", "--untracked-files=all"]));
  const output = resolve(scratch, "astro-cloudflare/output/v0");
  const build = JSON.parse(readFileSync(resolve(output, "config.json"), "utf8"));
  assert.equal(build.buildContext.mode, "production", "production build output required");
  const config = JSON.parse(readFileSync(resolve(output, "workers/default/worker.config.json"), "utf8"));
  assertProductionConfig(config);
}
