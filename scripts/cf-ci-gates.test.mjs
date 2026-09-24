import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  ALLOWED_CF_PREVIEW_ORIGINS,
  ASSERT_SCRIPT_REL,
  CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN,
  DEFAULT_CF_PREVIEW_ORIGIN,
  PREVIEW_CRON_ORIGIN,
  PREVIEW_CRON_TRIGGERS,
  PREVIEW_MIN_TRACKED_STARS,
  PREVIEW_PREFLIGHT_RELAX_EMPTY_SHARDS,
  PREVIEW_WORKFLOW_COLD_START,
  PRODUCTION_CRON_ORIGIN,
  PRODUCTION_MIN_TRACKED_STARS,
  PRODUCTION_WORKER_NAME,
  assertAllowedCfPreviewOrigin,
  assertCfCiGates,
  assertRepositoryCfCiGates,
  findForbiddenCloudflareMutations,
  findWranglerDeployInvocations,
  parseWranglerJsonc,
  planCfWranglerDryRun,
  readDefaultCfPreviewOrigin,
} from "./cf-ci-gates.mjs";

const validWrangler = `{
  "name": "gitstarclub-web",
  "vars": { "SITE_INDEXABLE": "1", "NEXT_PUBLIC_SITE_URL": "https://gitstarclub.com" },
  "triggers": { "crons": [] },
  "env": {
    "pre": {
      "name": "gitstarclub-web-pre",
      "queues": {
        "producers": [{ "binding": "JOBS", "queue": "gitstarclub-jobs-pre" }],
        "consumers": [{ "queue": "gitstarclub-jobs-pre", "max_batch_size": 1, "max_retries": 2 }]
      },
      "vars": {
        "BLOB_BASE_URL": "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com",
        "NEXT_PUBLIC_BLOB_BASE_URL": "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com",
        "WORKFLOW_RUNTIME": "cf-queue",
        "WORKFLOW_QUEUE_ENQUEUE_URL": "https://pre.gitstarclub.com/enqueue",
        "MIN_TRACKED_STARS": "1000",
        "PREFLIGHT_RELAX_EMPTY_SHARDS": "1",
        "WORKFLOW_COLD_START": "1"
      }
    }
  }
}`;

const validRuntime = 'export const DEFAULT_CF_PREVIEW_ORIGIN = "https://gitstarclub-web-pre.worldgo.workers.dev";';
const validCi = `
  preview-e2e:
    steps:
      - if: steps.deployment.outputs.skipped != 'true'
      - run: node scripts/assert-cf-ci-gates.mjs
  product-gates:
    if: \${{ needs.preview-e2e.outputs.skipped != 'true' }}
  cf-preview:
    if: \${{ vars.CF_PREVIEW_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    env:
      CF_PREVIEW_ORIGIN: \${{ vars.CF_PREVIEW_ORIGIN || 'https://gitstarclub-web-pre.worldgo.workers.dev' }}
    steps:
      - run: node scripts/assert-cf-ci-gates.mjs --preview-origin
  cf-workers-host:
    if: \${{ vars.CF_WORKERS_HOST_ENABLED == '1' && (github.ref_name == 'pre' || github.base_ref == 'pre') }}
    steps:
      - run: bun run cf:dry-run
`;
const validDelivery = `checks: [static, production-build]  # cf-preview / cf-workers-host MUST NOT be added
# Named by scripts/assert-cf-ci-gates.mjs
# main → gitstarclub-web (production; wrangler top-level triggers.crons MUST stay [])
# pre → gitstarclub-web-pre
`;
const validPackage = `{
  "scripts": {
    "cf:dry-run": "bun run cf:build && node ../scripts/cf-wrangler-dry-run.mjs"
  }
}`;

function alignedSources(overrides = {}) {
  return {
    wranglerSource: validWrangler,
    ciYml: validCi,
    deliveryYml: validDelivery,
    webPackageSource: validPackage,
    runtimeConfigSource: validRuntime,
    ...overrides,
  };
}

describe("CF CI gates", () => {
  test("requires production indexing and forbids preview indexing", () => {
    const missing = validWrangler.replace('"SITE_INDEXABLE": "1", ', "");
    assert.match(assertCfCiGates(alignedSources({ wranglerSource: missing })).join(" "), /SITE_INDEXABLE/);
    const previewEnabled = validWrangler.replace('"WORKFLOW_COLD_START": "1"', '"WORKFLOW_COLD_START": "1", "SITE_INDEXABLE": "1"');
    assert.match(assertCfCiGates(alignedSources({ wranglerSource: previewEnabled })).join(" "), /SITE_INDEXABLE/);
  });
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

  test("treats disabled dry-run and versions upload as live deploys", () => {
    assert.equal(findWranglerDeployInvocations("wrangler deploy --dry-run=false --env pre")[0].hasDryRun, false);
    assert.equal(findWranglerDeployInvocations("wrangler deploy --dry-run=0")[0].hasDryRun, false);
    assert.deepEqual(findWranglerDeployInvocations("bunx wrangler versions upload --env pre"), [
      { command: "wrangler versions upload --env pre", hasDryRun: false },
    ]);
  });

  test("refuses Cloudflare schedule mutations in automation", () => {
    assert.deepEqual(
      findForbiddenCloudflareMutations('curl -X PUT "https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/gitstarclub-web/schedules"'),
      [
        'refusing Cloudflare schedule mutation in repo automation: curl -X PUT "https://api.cloudflare.com/client/v4/accounts/x/workers/scripts/gitstarclub-web/schedules"',
      ],
    );
    assert.deepEqual(findForbiddenCloudflareMutations("# PUT production schedules later"), []);
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
    assert.ok(issues.some((issue) => issue.includes("top-level triggers.crons must stay []")));
  });

  test("rejects retired Vercel preview jobs as required delivery checks", () => {
    const issues = assertCfCiGates(
      alignedSources({
        ciYml: validCi.replace("steps.deployment.outputs.skipped", "steps.deployment.outputs.url"),
        deliveryYml: `checks: [static, production-build, preview-e2e, product-gates]  # cf-preview / cf-workers-host MUST NOT be added
# Named by scripts/assert-cf-ci-gates.mjs
# main → gitstarclub-web (production; wrangler top-level triggers.crons MUST stay [])
# pre → gitstarclub-web-pre
`,
      }),
    );
    assert.ok(issues.some((issue) => issue.includes("must not require preview-e2e or product-gates")));
    assert.ok(issues.some((issue) => issue.includes("soft-skip preview-e2e")));
  });

  test("rejects missing production cron list and unnamed delivery/assert contract", () => {
    const issues = assertCfCiGates(
      alignedSources({
        wranglerSource: `{
          "name": "gitstarclub-web",
          "env": { "pre": { "name": "gitstarclub-web-pre" } }
        }`,
        deliveryYml: "checks: [static, production-build]  # cf-preview / cf-workers-host MUST NOT be added",
        namingSources: {
          "docs/OPS.md": "Cloudflare preview without the assert script name",
        },
      }),
    );
    assert.ok(issues.some((issue) => issue.includes("top-level triggers.crons must stay []")));
    assert.ok(issues.some((issue) => issue.includes(".delivery.yml must name scripts/assert-cf-ci-gates.mjs")));
    assert.ok(issues.some((issue) => issue.includes(".delivery.yml must name preview Worker gitstarclub-web-pre")));
    assert.ok(issues.some((issue) => issue.includes("production triggers.crons []")));
    assert.ok(issues.some((issue) => issue.includes("docs/OPS.md must name scripts/assert-cf-ci-gates.mjs")));
  });

  test("accepts the aligned preview contract", () => {
    assert.deepEqual(assertCfCiGates(alignedSources()), []);
    assert.equal(readDefaultCfPreviewOrigin(validRuntime), DEFAULT_CF_PREVIEW_ORIGIN);
    assert.ok(ALLOWED_CF_PREVIEW_ORIGINS.includes(DEFAULT_CF_PREVIEW_ORIGIN));
  });

  test("rejects production cron triggers and mixed-environment cron origins", () => {
    const issues = assertCfCiGates(
      alignedSources({
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
      }),
    );
    assert.ok(issues.some((issue) => issue.includes("top-level triggers.crons must stay []")));
    assert.ok(issues.some((issue) => issue.includes("three Vercel-parity expressions")));
    assert.ok(issues.some((issue) => issue.includes(`top-level vars.CF_CRON_ORIGIN must be ${PRODUCTION_CRON_ORIGIN}`)));
    assert.ok(issues.some((issue) => issue.includes(`env.pre vars.CF_CRON_ORIGIN must be ${PREVIEW_CRON_ORIGIN}`)));
  });

  test("requires preview MIN_TRACKED_STARS=1000 and refuses production ≥1k", () => {
    const missingPreview = assertCfCiGates(alignedSources({ wranglerSource: `{
      "name": "gitstarclub-web",
      "triggers": { "crons": [] },
      "env": { "pre": { "name": "gitstarclub-web-pre" } }
    }` }));
    assert.ok(
      missingPreview.some((issue) =>
        issue.includes(`env.pre vars.MIN_TRACKED_STARS must be ${PREVIEW_MIN_TRACKED_STARS}`),
      ),
    );

    const productionExpanded = assertCfCiGates(alignedSources({ wranglerSource: `{
      "name": "gitstarclub-web",
      "triggers": { "crons": [] },
      "vars": { "MIN_TRACKED_STARS": "1000" },
      "env": {
        "pre": { "name": "gitstarclub-web-pre", "vars": { "MIN_TRACKED_STARS": "1000" } }
      }
    }` }));
    assert.ok(
      productionExpanded.some((issue) =>
        issue.includes(`top-level vars.MIN_TRACKED_STARS must be unset or ${PRODUCTION_MIN_TRACKED_STARS}`),
      ),
    );
  });

  test("allowlists only preview Worker origins", () => {
    assert.equal(assertAllowedCfPreviewOrigin(`${DEFAULT_CF_PREVIEW_ORIGIN}/`), DEFAULT_CF_PREVIEW_ORIGIN);
    assert.equal(assertAllowedCfPreviewOrigin("https://pre.gitstarclub.com"), "https://pre.gitstarclub.com");
    assert.throws(
      () => assertAllowedCfPreviewOrigin(CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN),
      /closed production workers.dev/,
    );
    assert.throws(() => assertAllowedCfPreviewOrigin("https://gitstarclub.com"), /must be /);
    assert.throws(() => assertAllowedCfPreviewOrigin(""), /empty/);
  });

  test("assert-cf-ci-gates.mjs is a distinct entry from cf-ci-gates.mjs", () => {
    const repo = spawnSync(process.execPath, ["scripts/assert-cf-ci-gates.mjs"], { encoding: "utf8" });
    assert.equal(repo.status, 0, repo.stderr);
    assert.equal([...repo.stdout.matchAll(/CF CI gates ok:/g)].length, 1);
    const preview = spawnSync(
      process.execPath,
      ["scripts/assert-cf-ci-gates.mjs", "--preview-origin"],
      {
        encoding: "utf8",
        env: { ...process.env, CF_PREVIEW_ORIGIN: DEFAULT_CF_PREVIEW_ORIGIN },
      },
    );
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /^CF_PREVIEW_ORIGIN=https:\/\/gitstarclub-web-pre\.worldgo\.workers\.dev\n$/);
    assert.equal(preview.stdout.includes("CF CI gates ok:"), false);
  });

  test("the checked-in repository satisfies the CF CI gates", () => {
    const summary = assertRepositoryCfCiGates(process.cwd());
    assert.equal(summary.previewWorker, "gitstarclub-web-pre");
    assert.equal(summary.productionWorker, PRODUCTION_WORKER_NAME);
    assert.equal(summary.previewOrigin, DEFAULT_CF_PREVIEW_ORIGIN);
    assert.equal(summary.assertScript, ASSERT_SCRIPT_REL);
    assert.deepEqual(summary.productionCrons, []);
    assert.deepEqual([...PREVIEW_CRON_TRIGGERS], ["0 3 * * *", "0 4 * * 0", "0 6 * * 0"]);
    const wrangler = parseWranglerJsonc(readFileSync("workers/gitstarclub-web/wrangler.jsonc", "utf8"));
    assert.deepEqual(wrangler.triggers.crons, []);
    assert.equal(wrangler.env.pre.name, "gitstarclub-web-pre");
    assert.equal(wrangler.env.pre.vars.MIN_TRACKED_STARS, PREVIEW_MIN_TRACKED_STARS);
    assert.equal(wrangler.env.pre.vars.PREFLIGHT_RELAX_EMPTY_SHARDS, "1");
    assert.equal(wrangler.env.pre.vars.WORKFLOW_COLD_START, "1");
    assert.equal(wrangler.vars.MIN_TRACKED_STARS, undefined);
    assert.equal(wrangler.vars.PREFLIGHT_RELAX_EMPTY_SHARDS, undefined);
    assert.equal(wrangler.vars.WORKFLOW_COLD_START, undefined);
  });

  test("refuses production PREFLIGHT_RELAX_EMPTY_SHARDS=1", () => {
    const issues = assertCfCiGates(
      alignedSources({
        wranglerSource: `{
  "name": "gitstarclub-web",
  "triggers": { "crons": [] },
  "vars": { "PREFLIGHT_RELAX_EMPTY_SHARDS": "1" },
  "env": {
    "pre": { "name": "gitstarclub-web-pre", "vars": { "MIN_TRACKED_STARS": "1000" } }
  }
}`,
      }),
    );
    assert.ok(
      issues.some((issue) => issue.includes("top-level vars.PREFLIGHT_RELAX_EMPTY_SHARDS must not be 1")),
    );
  });
});
