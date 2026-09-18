import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ALLOWED_CF_PREVIEW_ORIGINS,
  CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN,
  DEFAULT_CF_PREVIEW_ORIGIN,
  assertCfCiGates,
  assertRepositoryCfCiGates,
  findWranglerDeployInvocations,
  parseWranglerJsonc,
  planCfWranglerDryRun,
  readDefaultCfPreviewOrigin,
} from "./cf-ci-gates.mjs";

const validWrangler = `{
  "name": "gitstarclub-web",
  "env": {
    "pre": { "name": "gitstarclub-web-pre" }
  }
}`;

const validRuntime = 'export const DEFAULT_CF_PREVIEW_ORIGIN = "https://gitstarclub-web-pre.worldgo.workers.dev";';
const validCi = `
  cf-preview:
    if: \${{ vars.CF_PREVIEW_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    env:
      CF_PREVIEW_ORIGIN: \${{ vars.CF_PREVIEW_ORIGIN || 'https://gitstarclub-web-pre.worldgo.workers.dev' }}
  cf-workers-host:
    if: \${{ vars.CF_WORKERS_HOST_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    steps:
      - run: bun run cf:dry-run
`;
const validDelivery = "checks: [static, production-build, preview-e2e, product-gates]  # cf-preview / cf-workers-host MUST NOT be added";
const validPackage = `{
  "scripts": {
    "cf:dry-run": "bun run cf:build && node ../scripts/cf-wrangler-dry-run.mjs"
  }
}`;

describe("CF CI gates", () => {
  test("plans a dry-run against wrangler env pre only", () => {
    assert.deepEqual(planCfWranglerDryRun([]), {
      argv: [
        "deploy",
        "--dry-run",
        "--config",
        "../workers/gitstarclub-web/wrangler.jsonc",
        "--env",
        "pre",
      ],
      wranglerEnv: "pre",
      workerName: "gitstarclub-web-pre",
      dryRun: true,
    });
    assert.equal(planCfWranglerDryRun(["--env", "pre", "--keep-vars"]).argv.includes("--keep-vars"), true);
  });

  test("refuses production Worker name, empty env, and disabling dry-run", () => {
    assert.throws(() => planCfWranglerDryRun(["--name", "gitstarclub-web"]), /production Worker/);
    assert.throws(() => planCfWranglerDryRun(["--env", ""]), /only allows --env pre/);
    assert.throws(() => planCfWranglerDryRun(["--env", "nonprod"]), /only allows --env pre/);
    assert.throws(() => planCfWranglerDryRun(["--dry-run=false"]), /refuses to disable --dry-run/);
  });

  test("treats wrangler deploy without --dry-run as a live deploy", () => {
    assert.deepEqual(findWranglerDeployInvocations("wrangler deploy --config x.jsonc --env \"\""), [
      { command: 'wrangler deploy --config x.jsonc --env ""', hasDryRun: false },
    ]);
    assert.equal(findWranglerDeployInvocations("wrangler deploy --dry-run --env pre")[0].hasDryRun, true);
    assert.deepEqual(findWranglerDeployInvocations("# wrangler deploy without --dry-run"), []);
  });

  test("parses wrangler jsonc comments", () => {
    const parsed = parseWranglerJsonc(`{
      // production
      "name": "gitstarclub-web",
      "env": { "pre": { "name": "gitstarclub-web-pre" } }
    }`);
    assert.equal(parsed.env.pre.name, "gitstarclub-web-pre");
  });

  test("rejects closed production workers.dev and legacy nonprod names", () => {
    const issues = assertCfCiGates({
      wranglerSource: `{ "name": "gitstarclub-web", "env": { "nonprod": { "name": "gitstarclub-web-nonprod" } } }`,
      ciYml: validCi.replaceAll(DEFAULT_CF_PREVIEW_ORIGIN, CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN),
      deliveryYml: validDelivery,
      webPackageSource: `{ "scripts": { "cf:dry-run": "wrangler deploy --config x --env \\"\\"" } }`,
      runtimeConfigSource: `export const DEFAULT_CF_PREVIEW_ORIGIN = "${CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN}";`,
    });
    assert.ok(issues.some((issue) => issue.includes("env.nonprod")));
    assert.ok(issues.some((issue) => issue.includes("closed production")));
    assert.ok(issues.some((issue) => issue.includes("bare wrangler deploy")));
  });

  test("accepts the aligned preview contract", () => {
    assert.deepEqual(
      assertCfCiGates({
        wranglerSource: validWrangler,
        ciYml: validCi,
        deliveryYml: validDelivery,
        webPackageSource: validPackage,
        runtimeConfigSource: validRuntime,
      }),
      [],
    );
    assert.equal(readDefaultCfPreviewOrigin(validRuntime), DEFAULT_CF_PREVIEW_ORIGIN);
    assert.ok(ALLOWED_CF_PREVIEW_ORIGINS.includes(DEFAULT_CF_PREVIEW_ORIGIN));
  });

  test("the checked-in repository satisfies the CF CI gates", () => {
    const summary = assertRepositoryCfCiGates(process.cwd());
    assert.equal(summary.previewWorker, "gitstarclub-web-pre");
    assert.equal(summary.previewOrigin, DEFAULT_CF_PREVIEW_ORIGIN);
  });
});
