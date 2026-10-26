import { expect, test } from "bun:test";
import { astroHostWorker } from "../host-contract";
import { assertProductionBuild, assertProductionConfig } from "../scripts/production-deploy-guards";
import type { ProductionConfig } from "../scripts/production-deploy-guards";

const production = (): ProductionConfig => structuredClone(astroHostWorker("production"));
const commit = "a".repeat(40);
const stamp = () => ({ mode: "production", fixture: false, commit });

test("production guards accept the actual production host contract with its pinned KV id", () => {
  expect(() => assertProductionBuild(stamp(), commit, "")).not.toThrow();
  expect(() => assertProductionConfig(production())).not.toThrow();
});

test("production guards reject an unresolved production KV binding", () => {
  const config = production();
  config.env.GSC_CACHE = { type: "kv" };
  expect(() => assertProductionConfig(config)).toThrow("resolve and pin");
});

test("production guards reject preview configuration and build stamps", () => {
  expect(() => assertProductionConfig(astroHostWorker("pre"))).toThrow("production Worker");
  expect(() => assertProductionBuild({ ...stamp(), mode: "pre" }, commit, "")).toThrow("production artifact");
});

test("production guards reject fixture, missing, and stale build stamps", () => {
  for (const fixture of [true, "false", undefined, null]) {
    expect(() => assertProductionBuild({ ...stamp(), fixture }, commit, "")).toThrow("fixture builds");
  }
  expect(() => assertProductionBuild({ ...stamp(), commit: "b".repeat(40) }, commit, "")).toThrow("exact current commit");
  expect(() => assertProductionBuild({}, commit, "")).toThrow();
});

test("production guards reject modified, staged, and untracked checkout content", () => {
  for (const status of [" M astro/src/worker.ts\n", "M  astro/host-contract.ts\n", "?? unexpected.txt\n"]) {
    expect(() => assertProductionBuild(stamp(), commit, status)).toThrow("clean reviewed checkout");
  }
});

test("production guards reject any schedule, including one replacing the queue", () => {
  const schedule = { type: "scheduled", schedule: "0 3 * * *" };
  expect(() => assertProductionConfig({ ...production(), triggers: [...production().triggers, schedule] })).toThrow();
  expect(() => assertProductionConfig({ ...production(), triggers: [schedule] })).toThrow();
});

test("production guards require exactly one production queue", () => {
  for (const triggers of [[], [...production().triggers, ...production().triggers], [{ type: "queue", name: "gitstarclub-jobs-pre" }]]) {
    expect(() => assertProductionConfig({ ...production(), triggers })).toThrow();
  }
});

test("production guards reject route triggers, routes, and domains", () => {
  const route = { type: "route", pattern: "example.com/*" };
  expect(() => assertProductionConfig({ ...production(), triggers: [route] })).toThrow();
  expect(() => assertProductionConfig({ ...production(), triggers: [...production().triggers, route] })).toThrow();
  expect(() => assertProductionConfig({ ...production(), routes: [route] })).toThrow();
  expect(() => assertProductionConfig({ ...production(), domains: ["example.com"] })).toThrow();
});

test("production guards reject a missing, malformed, or preview KV id", () => {
  for (const id of [undefined, "", " ", "not-a-namespace", "4c3107414bad4a0386fedfcf96dde6e2"]) {
    const config = production();
    config.env.GSC_CACHE = { type: "kv", ...(id === undefined ? {} : { id }) };
    expect(() => assertProductionConfig(config)).toThrow();
  }
  const config = production();
  expect(() => assertProductionConfig({ ...config, env: { ...config.env, GSC_CACHE: { type: "text", value: config.env.GSC_CACHE.id } } })).toThrow();
  const { GSC_CACHE: _cache, ...env } = config.env;
  expect(() => assertProductionConfig({ ...config, env })).toThrow();
});

test("production guards reject preview resources and disabled indexing", () => {
  const preview: ProductionConfig = astroHostWorker("pre");
  for (const key of ["DATA", "JOBS", "DEPLOY_ENV", "R2_BUCKET", "R2_PUBLIC_BASE_URL", "STORAGE_READ_DRIVER", "STORAGE_WRITE_DRIVER", "SITE_INDEXABLE"] as const) {
    const config = production();
    const value = ["STORAGE_READ_DRIVER", "STORAGE_WRITE_DRIVER"].includes(key)
      ? { type: "text", value: "blob" }
      : preview.env[key];
    expect(() => assertProductionConfig({ ...config, env: { ...config.env, [key]: value } })).toThrow();
  }
});

test("production guards reject Blob bindings even when empty, and fixture flags", () => {
  for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "WORKFLOW_FIXTURE"]) {
    for (const value of ["", "http://127.0.0.1:4010"]) {
      const config = production();
      expect(() => assertProductionConfig({ ...config, env: { ...config.env, [key]: { type: "text", value } } })).toThrow();
    }
  }
});
