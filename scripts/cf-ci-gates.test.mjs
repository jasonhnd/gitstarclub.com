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
  PREVIEW_CRONS_PAUSED,
  PREVIEW_DEPLOY_ENV,
  PREVIEW_R2_BUCKET,
  PREVIEW_R2_PUBLIC_BASE_URL,
  PREVIEW_STORAGE_READ_DRIVER,
  PREVIEW_STORAGE_WRITE_DRIVER,
  PRODUCTION_BLOB_BASE_URL,
  PRODUCTION_CRON_ORIGIN,
  PRODUCTION_MIN_TRACKED_STARS,
  PRODUCTION_R2_BUCKET,
  PRODUCTION_WORKER_NAME,
  PRODUCTION_VIEWS_VERSION_FALLBACK,
  PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL,
  PRODUCTION_WORKFLOW_RUNTIME,
  assertAllowedCfPreviewOrigin,
  assertCfCiGates,
  assertRepositoryCfCiGates,
  cronUsesAmbiguousNumericWeekday,
  findForbiddenCloudflareMutations,
  findWranglerDeployInvocations,
  parseWranglerJsonc,
  planCfWranglerDryRun,
  readDefaultCfPreviewOrigin,
} from "./cf-ci-gates.mjs";

const validWrangler = `{
  "name": "gitstarclub-web",
  "workers_dev": false,
  "preview_urls": false,
  "vars": {
    "SITE_INDEXABLE": "1",
    "NEXT_PUBLIC_SITE_URL": "https://gitstarclub.com",
    "BLOB_BASE_URL": "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com",
    "NEXT_PUBLIC_BLOB_BASE_URL": "https://cdv7ejjwmzbbdj8w.public.blob.vercel-storage.com",
    "CF_CRON_ORIGIN": "https://gitstarclub.com",
    "WORKFLOW_RUNTIME": "cf-queue",
    "WORKFLOW_QUEUE_ENQUEUE_URL": "https://gitstarclub.com/enqueue",
    "VIEWS_VERSION_FALLBACK": "refresh-2026-09-13T06-00-16-398Z"
  },
  "triggers": { "crons": [] },
  "env": {
    "pre": {
      "name": "gitstarclub-web-pre",
      "workers_dev": true,
      "preview_urls": true,
      "triggers": { "crons": [] },
      "queues": {
        "producers": [{ "binding": "JOBS", "queue": "gitstarclub-jobs-pre" }],
        "consumers": [{ "queue": "gitstarclub-jobs-pre", "max_batch_size": 1, "max_retries": 2 }]
      },
      "r2_buckets": [
        { "binding": "MEDIA", "bucket_name": "gitstarclub-assets" },
        { "binding": "DATA", "bucket_name": "gitstarclub-data-pre" }
      ],
      "vars": {
        "DEPLOY_ENV": "pre",
        "STORAGE_READ_DRIVER": "r2",
        "STORAGE_WRITE_DRIVER": "r2_binding",
        "R2_BUCKET": "gitstarclub-data-pre",
        "R2_PUBLIC_BASE_URL": "https://data-pre.gitstarclub.com",
        "WORKFLOW_RUNTIME": "cf-queue",
        "WORKFLOW_QUEUE_ENQUEUE_URL": "https://pre.gitstarclub.com/enqueue",
        "MIN_TRACKED_STARS": "10000"
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
  test("Cloudflare build rejects missing and unknown targets before building", () => {
    for (const args of [[], ["--site-target=staging"], ["--site-target=pre", "--site-target=production"]]) {
      const result = spawnSync("bun", ["scripts/cf-opennext-build.ts", ...args], {
        cwd: new URL("../web/", import.meta.url),
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /requires exactly one --site-target=production or --site-target=pre/);
    }
  });
  test("requires production indexing and forbids preview indexing", () => {
    const missing = validWrangler.replace('"SITE_INDEXABLE": "1",\n', "");
    assert.match(assertCfCiGates(alignedSources({ wranglerSource: missing })).join(" "), /SITE_INDEXABLE/);
    const previewEnabled = validWrangler.replace(
      '"MIN_TRACKED_STARS": "10000"',
      '"MIN_TRACKED_STARS": "10000", "SITE_INDEXABLE": "1"',
    );
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
    assert.ok(issues.some((issue) => issue.includes("env.pre triggers.crons must be [] while preview schedules are paused")));
    assert.ok(issues.some((issue) => issue.includes("top-level triggers.crons must not use numeric weekday 0 or 7")));
    assert.ok(issues.some((issue) => issue.includes("env.pre triggers.crons must not use numeric weekday 0 or 7")));
    assert.ok(issues.some((issue) => issue.includes(`top-level vars.CF_CRON_ORIGIN must be ${PRODUCTION_CRON_ORIGIN}`)));
    assert.ok(issues.some((issue) => issue.includes(`env.pre vars.CF_CRON_ORIGIN must be ${PREVIEW_CRON_ORIGIN}`)));
  });

  test("keeps env.pre crons [] while preview schedules are paused (#543)", () => {
    assert.equal(PREVIEW_CRONS_PAUSED, true);
    const base = JSON.parse(validWrangler);

    const scheduled = structuredClone(base);
    scheduled.env.pre.triggers.crons = [...PREVIEW_CRON_TRIGGERS];
    const scheduledIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(scheduled) }));
    assert.ok(
      scheduledIssues.some((issue) => issue.includes("env.pre triggers.crons must be [] while preview schedules are paused")),
      scheduledIssues.join("\n"),
    );

    const missing = structuredClone(base);
    delete missing.env.pre.triggers;
    const missingIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(missing) }));
    assert.ok(
      missingIssues.some((issue) => issue.includes("env.pre triggers.crons must be [] while preview schedules are paused")),
      missingIssues.join("\n"),
    );
  });

  test("re-enabled preview requires the SUN expressions and rejects Saturday 7", () => {
    assert.deepEqual([...PREVIEW_CRON_TRIGGERS], ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]);
    const base = JSON.parse(validWrangler);

    const intended = structuredClone(base);
    intended.env.pre.triggers.crons = [...PREVIEW_CRON_TRIGGERS];
    assert.deepEqual(
      assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(intended), previewCronsPaused: false })),
      [],
    );

    const empty = assertCfCiGates(alignedSources({ previewCronsPaused: false }));
    assert.ok(empty.some((issue) => issue.includes("must be the three Cloudflare expressions")), empty.join("\n"));

    const saturday = structuredClone(base);
    saturday.env.pre.triggers.crons = ["0 3 * * *", "0 4 * * 7", "0 6 * * 7"];
    const saturdayIssues = assertCfCiGates(
      alignedSources({ wranglerSource: JSON.stringify(saturday), previewCronsPaused: false }),
    );
    assert.ok(saturdayIssues.some((issue) => issue.includes("must be the three Cloudflare expressions")));
    assert.ok(
      saturdayIssues.some((issue) => issue.includes("env.pre triggers.crons must not use numeric weekday 0 or 7")),
      saturdayIssues.join("\n"),
    );
  });

  test("flags numeric weekday 0 or 7 as ambiguous (Cloudflare 7 = Saturday)", () => {
    for (const cron of ["0 4 * * 7", "0 6 * * 0", "0 4 * * 5-7", "0 4 * * 1,7", "0 4 * * 7L", "0 4 * * 0#2"]) {
      assert.equal(cronUsesAmbiguousNumericWeekday(cron), true, cron);
    }
    for (const cron of ["0 3 * * *", "0 4 * * SUN", "0 6 * * sun", "0 4 * * 1", "0 4 * * SAT", "0 4 * * 2-6", 7, "0 4 * 7"]) {
      assert.equal(cronUsesAmbiguousNumericWeekday(cron), false, String(cron));
    }
  });

  test("requires preview MIN_TRACKED_STARS to equal production and refuses a 1k floor", () => {
    const missingPreview = assertCfCiGates(alignedSources({ wranglerSource: `{
      "name": "gitstarclub-web",
      "triggers": { "crons": [] },
      "env": { "pre": { "name": "gitstarclub-web-pre" } }
    }` }));
    assert.ok(
      missingPreview.some((issue) =>
        issue.includes(`env.pre vars.MIN_TRACKED_STARS must equal production (${PRODUCTION_MIN_TRACKED_STARS})`),
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
    assert.deepEqual([...PREVIEW_CRON_TRIGGERS], ["0 3 * * *", "0 4 * * SUN", "0 6 * * SUN"]);
    const wrangler = parseWranglerJsonc(readFileSync("workers/gitstarclub-web/wrangler.jsonc", "utf8"));
    assert.deepEqual(wrangler.triggers.crons, []);
    assert.deepEqual(wrangler.env.pre.triggers.crons, []);
    assert.equal(wrangler.env.pre.name, "gitstarclub-web-pre");
    assert.equal(wrangler.env.pre.vars.MIN_TRACKED_STARS, PRODUCTION_MIN_TRACKED_STARS);
    assert.equal(wrangler.env.pre.vars.PREFLIGHT_RELAX_EMPTY_SHARDS, undefined);
    assert.equal(wrangler.env.pre.vars.WORKFLOW_COLD_START, undefined);
    assert.equal(wrangler.env.pre.vars.DEPLOY_ENV, PREVIEW_DEPLOY_ENV);
    assert.equal(wrangler.env.pre.vars.STORAGE_READ_DRIVER, PREVIEW_STORAGE_READ_DRIVER);
    assert.equal(wrangler.env.pre.vars.STORAGE_WRITE_DRIVER, PREVIEW_STORAGE_WRITE_DRIVER);
    assert.equal(wrangler.env.pre.vars.R2_BUCKET, PREVIEW_R2_BUCKET);
    assert.equal(wrangler.env.pre.vars.R2_PUBLIC_BASE_URL, PREVIEW_R2_PUBLIC_BASE_URL);
    assert.equal(wrangler.env.pre.vars.R2_PREFIX, undefined);
    assert.equal(wrangler.env.pre.vars.BLOB_BASE_URL, undefined);
    assert.equal(wrangler.env.pre.vars.NEXT_PUBLIC_BLOB_BASE_URL, undefined);
    assert.equal(
      wrangler.env.pre.r2_buckets.find((entry) => entry.binding === "DATA").bucket_name,
      PREVIEW_R2_BUCKET,
    );
    assert.equal(wrangler.r2_buckets.find((entry) => entry.binding === "DATA"), undefined);
    assert.equal(wrangler.vars.MIN_TRACKED_STARS, undefined);
    assert.equal(wrangler.vars.PREFLIGHT_RELAX_EMPTY_SHARDS, undefined);
    assert.equal(wrangler.vars.WORKFLOW_COLD_START, undefined);
    assert.equal(wrangler.workers_dev, false);
    assert.equal(wrangler.preview_urls, false);
    assert.equal(wrangler.env.pre.workers_dev, true);
    assert.equal(wrangler.env.pre.preview_urls, true);
    assert.equal(wrangler.vars.BLOB_BASE_URL, PRODUCTION_BLOB_BASE_URL);
    assert.equal(wrangler.vars.NEXT_PUBLIC_BLOB_BASE_URL, PRODUCTION_BLOB_BASE_URL);
    assert.equal(wrangler.vars.CF_CRON_ORIGIN, PRODUCTION_CRON_ORIGIN);
    assert.equal(wrangler.vars.WORKFLOW_RUNTIME, PRODUCTION_WORKFLOW_RUNTIME);
    assert.equal(wrangler.vars.WORKFLOW_QUEUE_ENQUEUE_URL, PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL);
    assert.equal(wrangler.vars.VIEWS_VERSION_FALLBACK, PRODUCTION_VIEWS_VERSION_FALLBACK);
    assert.equal(wrangler.env.pre.vars.VIEWS_VERSION_FALLBACK, undefined);
    assert.equal(wrangler.vars.CF_PREVIEW_COMMIT_SHA, undefined);
    assert.equal(wrangler.env.pre.vars.CF_PREVIEW_COMMIT_SHA, undefined);
  });

  test("rejects a production config that drops plaintext vars or reopens workers.dev", () => {
    const base = JSON.parse(validWrangler);
    for (const key of [
      "BLOB_BASE_URL",
      "NEXT_PUBLIC_BLOB_BASE_URL",
      "CF_CRON_ORIGIN",
      "WORKFLOW_RUNTIME",
      "WORKFLOW_QUEUE_ENQUEUE_URL",
      "VIEWS_VERSION_FALLBACK",
    ]) {
      const config = structuredClone(base);
      delete config.vars[key];
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(
        issues.some((issue) => issue.includes(`top-level vars.${key} must be`)),
        issues.join("\n"),
      );
    }
    for (const key of ["workers_dev", "preview_urls"]) {
      const config = structuredClone(base);
      delete config[key];
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(
        issues.some((issue) => issue.includes(`top-level ${key} must be false`)),
        issues.join("\n"),
      );
    }
    const reopened = structuredClone(base);
    reopened.workers_dev = true;
    reopened.preview_urls = true;
    const reopenedIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(reopened) }));
    assert.ok(reopenedIssues.some((issue) => issue.includes("top-level workers_dev must be false")));
    assert.ok(reopenedIssues.some((issue) => issue.includes("top-level preview_urls must be false")));

    const inherited = structuredClone(base);
    delete inherited.env.pre.workers_dev;
    const inheritedIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(inherited) }));
    assert.ok(inheritedIssues.some((issue) => issue.includes("env.pre workers_dev must be true")));

    for (const previewUrls of [false, undefined]) {
      const config = structuredClone(base);
      if (previewUrls === undefined) delete config.env.pre.preview_urls;
      else config.env.pre.preview_urls = previewUrls;
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(
        issues.some((issue) => issue.includes("env.pre preview_urls must be true")),
        issues.join("\n"),
      );
    }

    const sha = structuredClone(base);
    sha.vars.CF_PREVIEW_COMMIT_SHA = "0123456789abcdef";
    const shaIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(sha) }));
    assert.ok(shaIssues.some((issue) => issue.includes("CF_PREVIEW_COMMIT_SHA must not be committed")));
  });

  test("refuses VIEWS_VERSION_FALLBACK on preview", () => {
    const config = JSON.parse(validWrangler);
    config.env.pre.vars.VIEWS_VERSION_FALLBACK = PRODUCTION_VIEWS_VERSION_FALLBACK;
    const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
    assert.ok(
      issues.some((issue) => issue.includes("env.pre vars.VIEWS_VERSION_FALLBACK must not be set")),
      issues.join("\n"),
    );
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
      issues.some((issue) => issue.includes("top-level vars.PREFLIGHT_RELAX_EMPTY_SHARDS must be absent")),
    );
  });

  test("rejects preview and production storage cross-wiring", () => {
    const prodBucket = JSON.parse(validWrangler);
    const previewData = prodBucket.env.pre.r2_buckets.find((entry) => entry.binding === "DATA");
    previewData.bucket_name = PRODUCTION_R2_BUCKET;
    prodBucket.env.pre.vars.R2_BUCKET = PRODUCTION_R2_BUCKET;
    const prodBucketIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(prodBucket) }));
    assert.ok(
      prodBucketIssues.some((issue) => issue.includes(`DATA bucket_name must be ${PREVIEW_R2_BUCKET}`)),
      prodBucketIssues.join("\n"),
    );
    assert.ok(
      prodBucketIssues.some((issue) => issue.includes(`must not mention ${PRODUCTION_R2_BUCKET}`)),
      prodBucketIssues.join("\n"),
    );

    const preDomain = JSON.parse(validWrangler);
    preDomain.vars.R2_PUBLIC_BASE_URL = PREVIEW_R2_PUBLIC_BASE_URL;
    const preDomainIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(preDomain) }));
    assert.ok(
      preDomainIssues.some((issue) => issue.includes("top-level must not mention data-pre.gitstarclub.com")),
      preDomainIssues.join("\n"),
    );

    const blobOnPreview = JSON.parse(validWrangler);
    blobOnPreview.env.pre.vars.BLOB_BASE_URL = PRODUCTION_BLOB_BASE_URL;
    const blobIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(blobOnPreview) }));
    assert.ok(
      blobIssues.some((issue) => issue.includes("must not contain BLOB_*")),
      blobIssues.join("\n"),
    );

    const coldStart = JSON.parse(validWrangler);
    coldStart.env.pre.vars.WORKFLOW_COLD_START = "1";
    const coldIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(coldStart) }));
    assert.ok(
      coldIssues.some((issue) => issue.includes("env.pre vars.WORKFLOW_COLD_START must be absent")),
      coldIssues.join("\n"),
    );

    const missingDeploy = JSON.parse(validWrangler);
    delete missingDeploy.env.pre.vars.DEPLOY_ENV;
    const deployIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(missingDeploy) }));
    assert.ok(
      deployIssues.some((issue) => issue.includes(`vars.DEPLOY_ENV must be ${PREVIEW_DEPLOY_ENV}`)),
      deployIssues.join("\n"),
    );

    const prefixed = JSON.parse(validWrangler);
    prefixed.env.pre.vars.R2_PREFIX = "migrate-dev/";
    const prefixIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(prefixed) }));
    assert.ok(
      prefixIssues.some((issue) => issue.includes("R2_PREFIX must be unset or empty")),
      prefixIssues.join("\n"),
    );

    const emptyPrefix = JSON.parse(validWrangler);
    emptyPrefix.env.pre.vars.R2_PREFIX = "";
    assert.deepEqual(assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(emptyPrefix) })), []);

    const sameBucket = JSON.parse(validWrangler);
    sameBucket.r2_buckets = [{ binding: "DATA", bucket_name: PREVIEW_R2_BUCKET }];
    const sameIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(sameBucket) }));
    assert.ok(
      sameIssues.some((issue) => issue.includes("DATA bucket must differ from the top-level DATA bucket")),
      sameIssues.join("\n"),
    );

    const inherited = JSON.parse(validWrangler);
    delete inherited.env.pre.r2_buckets;
    delete inherited.env.pre.vars;
    const inheritedIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(inherited) }));
    assert.ok(
      inheritedIssues.some((issue) => issue.includes("must declare its own r2_buckets")),
      inheritedIssues.join("\n"),
    );
    assert.ok(
      inheritedIssues.some((issue) => issue.includes("must declare its own vars")),
      inheritedIssues.join("\n"),
    );
  });

  test("treats production and preview R2 hosts case-insensitively", () => {
    const previewHost = JSON.parse(validWrangler);
    previewHost.env.pre.vars.R2_PUBLIC_BASE_URL = "https://DATA.gitstarclub.com";
    const previewIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(previewHost) }));
    assert.ok(
      previewIssues.some((issue) => issue.includes("env.pre must not mention data.gitstarclub.com")),
      previewIssues.join("\n"),
    );

    const previewNote = JSON.parse(validWrangler);
    previewNote.env.pre.vars.NOTE = "see https://Data.Gitstarclub.com/views/latest.json";
    const noteIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(previewNote) }));
    assert.ok(
      noteIssues.some((issue) => issue.includes("env.pre must not mention data.gitstarclub.com")),
      noteIssues.join("\n"),
    );
    assert.equal(
      noteIssues.some((issue) => issue.includes("R2_PUBLIC_BASE_URL must be")),
      false,
      noteIssues.join("\n"),
    );

    const topHost = JSON.parse(validWrangler);
    topHost.vars.NOTE = "https://DATA-PRE.GITSTARCLUB.COM/bootstrap/latest.json";
    const topIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(topHost) }));
    assert.ok(
      topIssues.some((issue) => issue.includes("top-level must not mention data-pre.gitstarclub.com")),
      topIssues.join("\n"),
    );
  });

  test("cf:build public read base matches the target and rejects the other environment", () => {
    const wrangler = {
      vars: {
        BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
        NEXT_PUBLIC_BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
      },
      env: {
        pre: {
          vars: {
            R2_PUBLIC_BASE_URL: PREVIEW_R2_PUBLIC_BASE_URL,
          },
        },
      },
    };
    const cases = [
      {
        name: "preview match",
        input: {
          target: "pre",
          shell: {
            R2_PUBLIC_BASE_URL: `${PREVIEW_R2_PUBLIC_BASE_URL}/`,
            BLOB_BASE_URL: "http://127.0.0.1:4010",
          },
          wrangler,
        },
        expect: [],
      },
      {
        name: "production match",
        input: {
          target: "production",
          shell: {
            BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
            NEXT_PUBLIC_BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
          },
          wrangler,
        },
        expect: [],
      },
      {
        name: "production fixture",
        input: {
          target: "production",
          shell: { BLOB_BASE_URL: "http://127.0.0.1:4010" },
          wrangler,
        },
        expect: [],
      },
      {
        name: "preview bakes production blob",
        input: {
          target: "pre",
          shell: {
            R2_PUBLIC_BASE_URL: PREVIEW_R2_PUBLIC_BASE_URL,
            BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
          },
          wrangler,
        },
        includes: "belongs to production",
      },
      {
        name: "production bakes preview domain",
        input: {
          target: "production",
          shell: {
            BLOB_BASE_URL: PRODUCTION_BLOB_BASE_URL,
            R2_PUBLIC_BASE_URL: PREVIEW_R2_PUBLIC_BASE_URL,
          },
          wrangler,
        },
        includes: "belongs to pre",
      },
      {
        name: "preview mismatches its own domain",
        input: {
          target: "pre",
          shell: { R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com" },
          wrangler,
        },
        includes: "declares R2_PUBLIC_BASE_URL=https://data-pre.gitstarclub.com",
      },
    ];
    const result = spawnSync(
      "bun",
      [
        "-e",
        `import { publicReadBaseMismatches } from "./scripts/cf-opennext-build.ts";
         const cases = JSON.parse(process.env["PUBLIC_READ_CASES"]);
         const report = cases.map((entry) => ({ name: entry.name, issues: publicReadBaseMismatches(entry.input) }));
         process.stdout.write(JSON.stringify(report));`,
      ],
      {
        cwd: new URL("../web/", import.meta.url),
        encoding: "utf8",
        env: { ...process.env, PUBLIC_READ_CASES: JSON.stringify(cases) },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    for (const entry of cases) {
      const found = report.find((item) => item.name === entry.name);
      assert.ok(found, entry.name);
      if (entry.expect) assert.deepEqual(found.issues, entry.expect, entry.name);
      if (entry.includes) assert.ok(found.issues.join("\n").includes(entry.includes), `${entry.name}: ${found.issues.join("\n")}`);
    }

    const mismatch = spawnSync("bun", ["scripts/cf-opennext-build.ts", "--site-target=pre"], {
      cwd: new URL("../web/", import.meta.url),
      encoding: "utf8",
      timeout: 20000,
      env: {
        ...process.env,
        R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com",
        BLOB_BASE_URL: "http://127.0.0.1:4010",
        NEXT_PUBLIC_BLOB_BASE_URL: "",
        NEXT_PUBLIC_R2_PUBLIC_BASE_URL: "",
      },
    });
    assert.notEqual(mismatch.status, 0);
    assert.match(mismatch.stderr, /data\.gitstarclub\.com/);
    assert.equal(mismatch.stdout.includes("opennextjs-cloudflare"), false);
    assert.equal(mismatch.stderr.includes("opennextjs-cloudflare"), false);
  });
});
