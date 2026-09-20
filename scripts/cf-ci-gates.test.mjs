import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ALLOWED_CF_PREVIEW_ORIGINS,
  CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN,
  DEFAULT_CF_PREVIEW_ORIGIN,
  PREVIEW_CRON_ORIGIN,
  PREVIEW_CRON_TRIGGERS,
  PRODUCTION_CRON_ORIGIN,
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
  preview-e2e:
    steps:
      - if: steps.deployment.outputs.skipped != 'true'
  product-gates:
    if: \${{ needs.preview-e2e.outputs.skipped != 'true' }}
  cf-preview:
    if: \${{ vars.CF_PREVIEW_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    env:
      CF_PREVIEW_ORIGIN: \${{ vars.CF_PREVIEW_ORIGIN || 'https://gitstarclub-web-pre.worldgo.workers.dev' }}
  cf-workers-host:
    if: \${{ vars.CF_WORKERS_HOST_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    steps:
      - run: bun run cf:dry-run
`;
const validDelivery = "checks: [static, production-build]  # cf-preview / cf-workers-host MUST NOT be added";
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

  test("rejects retired Vercel preview jobs as required delivery checks", () => {
    const issues = assertCfCiGates({
      wranglerSource: validWrangler,
      ciYml: validCi.replace("steps.deployment.outputs.skipped", "steps.deployment.outputs.url"),
      deliveryYml: "checks: [static, production-build, preview-e2e, product-gates]  # cf-preview / cf-workers-host MUST NOT be added",
      webPackageSource: validPackage,
      runtimeConfigSource: validRuntime,
    });
    assert.ok(issues.some((issue) => issue.includes("must not require preview-e2e or product-gates")));
    assert.ok(issues.some((issue) => issue.includes("soft-skip preview-e2e")));
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

  test("rejects production cron triggers and mixed-environment cron origins", () => {
    const issues = assertCfCiGates({
      wranglerSource: `{
        "name": "gitstarclub-web",
        "triggers": { "crons": ["0 6 * * 0"] },
        "vars": { "CF_CRON_ORIGIN": "https://pre.gitstarclub.com" },
        "env": {
          "pre": {
            "name": "gitstarclub-web-pre",
            "triggers": { "crons": ["0 6 * * 0"] },
            "vars": { "CF_CRON_ORIGIN": "https://gitstarclub.com" }
          }
        }
      }`,
      ciYml: validCi,
      deliveryYml: validDelivery,
      webPackageSource: validPackage,
      runtimeConfigSource: validRuntime,
    });
    assert.ok(issues.some((issue) => issue.includes("top-level triggers.crons must stay []")));
    assert.ok(issues.some((issue) => issue.includes("three Vercel-parity expressions")));
    assert.ok(issues.some((issue) => issue.includes(`top-level vars.CF_CRON_ORIGIN must be ${PRODUCTION_CRON_ORIGIN}`)));
    assert.ok(issues.some((issue) => issue.includes(`env.pre vars.CF_CRON_ORIGIN must be ${PREVIEW_CRON_ORIGIN}`)));
  });

  test("the checked-in repository satisfies the CF CI gates", () => {
    const summary = assertRepositoryCfCiGates(process.cwd());
    assert.equal(summary.previewWorker, "gitstarclub-web-pre");
    assert.equal(summary.previewOrigin, DEFAULT_CF_PREVIEW_ORIGIN);
    assert.deepEqual([...PREVIEW_CRON_TRIGGERS], ["0 3 * * *", "0 4 * * 0", "0 6 * * 0"]);
    const wrangler = parseWranglerJsonc(readFileSync("workers/gitstarclub-web/wrangler.jsonc", "utf8"));
    assert.deepEqual(wrangler.triggers.crons, []);
  });
});
