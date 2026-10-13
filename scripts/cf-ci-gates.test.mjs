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
  PREVIEW_R2_PUBLIC_HOST,
  PRODUCTION_R2_PUBLIC_HOST,
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
  stripJsonc,
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

function stage4Wrangler() {
  const config = JSON.parse(validWrangler);
  for (const key of ["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL"]) {
    delete config.vars[key];
  }
  Object.assign(config.vars, {
    DEPLOY_ENV: "production",
    STORAGE_READ_DRIVER: "r2",
    STORAGE_WRITE_DRIVER: "r2_binding",
    R2_BUCKET: "gitstarclub-data-prod",
    R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com",
    VIEWS_VERSION_FALLBACK: PRODUCTION_VIEWS_VERSION_FALLBACK,
  });
  config.r2_buckets = [
    { binding: "MEDIA", bucket_name: "gitstarclub-assets" },
    { binding: "DATA", bucket_name: "gitstarclub-data-prod" },
  ];
  return config;
}

describe("production stage-4 storage contract", () => {
  test("preserves combined stage-4 diagnostic order without mutating sources", () => {
    const config = stage4Wrangler();
    Object.assign(config.vars, {
      CF_CRON_ORIGIN: "wrong",
      WORKFLOW_RUNTIME: "wrong",
      WORKFLOW_QUEUE_ENQUEUE_URL: "wrong",
      STORAGE_READ_DRIVER: "blob",
      STORAGE_WRITE_DRIVER: "r2_s3",
      R2_BUCKET: "gitstarclub-data-pre",
      R2_PUBLIC_BASE_URL: "https://DATA-PRE.GITSTARCLUB.COM",
      BLOB_BASE_URL: "",
      VIEWS_VERSION_FALLBACK: "",
      R2_PREFIX: "migrate-dev/",
      READ_DRIVER: "blob",
      WRITE_DRIVER: "blob",
    });
    config.r2_buckets.push({ binding: "DATA", bucket_name: "gitstarclub-data-prod" });
    config.env.pre.vars.NOTE = "https://Data.Gitstarclub.com/views/latest.json";
    const sources = Object.freeze(alignedSources({ wranglerSource: JSON.stringify(config) }));
    const before = structuredClone(sources);
    const expected = [
      "wrangler top-level vars.CF_CRON_ORIGIN must be https://gitstarclub.com",
      "wrangler top-level vars.WORKFLOW_RUNTIME must be cf-queue",
      "wrangler top-level vars.WORKFLOW_QUEUE_ENQUEUE_URL must be https://gitstarclub.com/enqueue",
      "wrangler top-level vars.STORAGE_READ_DRIVER must be r2",
      "wrangler top-level vars.STORAGE_WRITE_DRIVER must be r2_binding",
      "wrangler top-level vars.R2_BUCKET must be gitstarclub-data-prod",
      "wrangler top-level vars.R2_PUBLIC_BASE_URL must be https://data.gitstarclub.com",
      "wrangler env.pre must not mention data.gitstarclub.com",
      "wrangler top-level must not mention gitstarclub-data-pre",
      "wrangler top-level must not mention data-pre.gitstarclub.com",
      "wrangler top-level stage-4 r2_buckets must declare exactly one DATA binding to gitstarclub-data-prod",
      "wrangler top-level stage-4 must not contain BLOB_* (production reads R2)",
      `wrangler top-level stage-4 vars.VIEWS_VERSION_FALLBACK must be absent or ${PRODUCTION_VIEWS_VERSION_FALLBACK} (received "")`,
      "wrangler top-level stage-4 vars.R2_PREFIX must be unset or empty",
      "wrangler top-level stage-4 vars.READ_DRIVER must be unset or r2",
      "wrangler top-level stage-4 vars.WRITE_DRIVER must be unset or r2_binding",
    ];
    assert.deepEqual(assertCfCiGates(sources), expected);
    assert.deepEqual(assertCfCiGates(sources), expected);
    assert.deepEqual(sources, before);
  });

  test("preserves pre-cutover production runtime diagnostic order", () => {
    const config = JSON.parse(validWrangler);
    for (const key of [
      "CF_CRON_ORIGIN", "WORKFLOW_RUNTIME", "WORKFLOW_QUEUE_ENQUEUE_URL",
      "BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "VIEWS_VERSION_FALLBACK",
    ]) {
      delete config.vars[key];
    }
    assert.deepEqual(assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) })), [
      `wrangler top-level vars.CF_CRON_ORIGIN must be ${PRODUCTION_CRON_ORIGIN}`,
      `wrangler top-level vars.WORKFLOW_RUNTIME must be ${PRODUCTION_WORKFLOW_RUNTIME}`,
      `wrangler top-level vars.WORKFLOW_QUEUE_ENQUEUE_URL must be ${PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL}`,
      `wrangler top-level vars.BLOB_BASE_URL must be ${PRODUCTION_BLOB_BASE_URL}`,
      `wrangler top-level vars.NEXT_PUBLIC_BLOB_BASE_URL must be ${PRODUCTION_BLOB_BASE_URL}`,
      `wrangler top-level vars.VIEWS_VERSION_FALLBACK must be ${PRODUCTION_VIEWS_VERSION_FALLBACK}`,
    ]);
  });

  test("accepts the complete R2 cutover and the unchanged current Blob config", () => {
    assert.deepEqual(assertCfCiGates(alignedSources()), []);
    assert.deepEqual(assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(stage4Wrangler()) })), []);
  });

  test("rejects missing or incorrect stage-4 vars and driver aliases", () => {
    const required = {
      DEPLOY_ENV: "production",
      STORAGE_READ_DRIVER: "r2",
      STORAGE_WRITE_DRIVER: "r2_binding",
      R2_BUCKET: "gitstarclub-data-prod",
      R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com",
    };
    for (const [key, expected] of Object.entries(required)) {
      for (const replacement of [undefined, "", "wrong"]) {
        const config = stage4Wrangler();
        if (replacement === undefined) delete config.vars[key];
        else config.vars[key] = replacement;
        const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
        assert.ok(issues.length > 0, `${key}=${replacement} must not pass`);
        if (key !== "DEPLOY_ENV") {
          assert.ok(issues.some((issue) => issue.includes(`vars.${key} must be ${expected}`)), issues.join("\n"));
        }
      }
    }
    for (const [key, value] of [
      ["STORAGE_READ_DRIVER", "r2_then_blob"], ["STORAGE_READ_DRIVER", "r2_s3"],
      ["STORAGE_WRITE_DRIVER", "r2_s3"], ["READ_DRIVER", "blob"], ["WRITE_DRIVER", "r2"],
    ]) {
      const config = stage4Wrangler();
      config.vars[key] = value;
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(issues.some((issue) => issue.includes(`vars.${key} must be`)), issues.join("\n"));
    }
  });

  test("rejects stage-4 Blob remnants, frozen fallback, and non-root prefix", () => {
    for (const [key, value, fragment] of [
      ["BLOB_BASE_URL", PRODUCTION_BLOB_BASE_URL, "must not contain BLOB_*"],
      ["NEXT_PUBLIC_BLOB_BASE_URL", "", "must not contain BLOB_*"],
      ["BLOB_READ_WRITE_TOKEN", "test-only-placeholder", "must not contain BLOB_*"],
      ["VIEWS_VERSION_FALLBACK", "wrong-fallback", "VIEWS_VERSION_FALLBACK must be absent or"],
      ["R2_PREFIX", "migrate-dev/", "R2_PREFIX must be unset or empty"],
    ]) {
      const config = stage4Wrangler();
      config.vars[key] = value;
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(issues.some((issue) => issue.includes(fragment)), `${key}: ${issues.join("\n")}`);
    }
    const root = stage4Wrangler();
    root.vars.R2_PREFIX = "";
    root.vars.READ_DRIVER = "r2";
    root.vars.WRITE_DRIVER = "r2_binding";
    assert.deepEqual(assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(root) })), []);
  });

  test("requires one production DATA binding and preserves bucket and domain isolation", () => {
    const mutations = [
      (config) => { delete config.r2_buckets; },
      (config) => { config.r2_buckets = [{ binding: "MEDIA", bucket_name: "gitstarclub-assets" }]; },
      (config) => { config.r2_buckets.push({ binding: "DATA", bucket_name: "gitstarclub-data-prod" }); },
      (config) => { config.r2_buckets[1].bucket_name = "gitstarclub-other"; },
      (config) => { config.r2_buckets[1].bucket_name = "gitstarclub-data-pre"; },
      (config) => { config.env.pre.r2_buckets[1].bucket_name = "gitstarclub-data-prod"; },
      (config) => { config.vars.R2_PUBLIC_BASE_URL = "https://DATA-PRE.gitstarclub.com"; },
      (config) => { config.env.pre.vars.R2_PUBLIC_BASE_URL = "https://DATA.gitstarclub.com"; },
      (config) => { config.vars.NOTE = "https://DATA-PRE.gitstarclub.com"; },
      (config) => { config.env.pre.vars.NOTE = "https://DATA.gitstarclub.com"; },
      (config) => { config.env.pre.vars.BLOB_BASE_URL = PRODUCTION_BLOB_BASE_URL; },
      (config) => { config.triggers.crons = ["0 3 * * *"]; },
      (config) => { config.vars.SITE_INDEXABLE = "0"; },
      (config) => { config.workers_dev = true; },
    ];
    for (const mutate of mutations) {
      const config = stage4Wrangler();
      mutate(config);
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(issues.length > 0, `${mutate}: incomplete or cross-wired stage-4 config passed`);
    }
  });
});

describe("CF CI gates", () => {
  test("cf:build stage-4 requires an explicit R2 shell and refuses Blob fallback", () => {
    const wrangler = stage4Wrangler();
    const valid = { STORAGE_READ_DRIVER: "r2", R2_PUBLIC_BASE_URL: "https://data.gitstarclub.com" };
    const cases = [
      { name: "production R2", shell: valid, expect: [] },
      { name: "loopback R2", shell: { ...valid, R2_PUBLIC_BASE_URL: "http://127.0.0.1:4010" }, expect: [] },
      { name: "missing driver", shell: { R2_PUBLIC_BASE_URL: valid.R2_PUBLIC_BASE_URL }, includes: "STORAGE_READ_DRIVER=r2" },
      { name: "Blob driver", shell: { ...valid, STORAGE_READ_DRIVER: "blob" }, includes: "STORAGE_READ_DRIVER=r2" },
      { name: "fallback driver", shell: { ...valid, STORAGE_READ_DRIVER: "r2_then_blob" }, includes: "STORAGE_READ_DRIVER=r2" },
      { name: "missing base", shell: { STORAGE_READ_DRIVER: "r2" }, includes: "requires shell R2_PUBLIC_BASE_URL" },
      { name: "empty base", shell: { ...valid, R2_PUBLIC_BASE_URL: " " }, includes: "requires shell R2_PUBLIC_BASE_URL" },
      { name: "preview base", shell: { ...valid, R2_PUBLIC_BASE_URL: PREVIEW_R2_PUBLIC_BASE_URL }, includes: "belongs to pre" },
      { name: "unknown base", shell: { ...valid, R2_PUBLIC_BASE_URL: "https://other.example" }, includes: "declares R2_PUBLIC_BASE_URL" },
      { name: "conflicting alias", shell: { ...valid, READ_DRIVER: "blob" }, includes: "conflicting shell READ_DRIVER" },
      ...["BLOB_BASE_URL", "NEXT_PUBLIC_BLOB_BASE_URL", "BLOB_READ_WRITE_TOKEN"].map((key) => ({
        name: `Blob remnant ${key}`,
        shell: { ...valid, [key]: "" },
        includes: "refuses shell BLOB_*",
      })),
    ];
    const result = spawnSync("bun", ["-e", `
      import { publicReadBaseMismatches, assertBuildPublicReadBase } from "./scripts/cf-opennext-build.ts";
      const { cases, wrangler } = JSON.parse(process.argv.at(-1));
      const report = cases.map((entry) => {
        const input = { target: "production", shell: entry.shell, wrangler };
        let rejected = false;
        try { assertBuildPublicReadBase(input); } catch { rejected = true; }
        return { name: entry.name, issues: publicReadBaseMismatches(input), rejected };
      });
      process.stdout.write(JSON.stringify(report));
    `, JSON.stringify({ cases, wrangler })], {
      cwd: new URL("../web/", import.meta.url),
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    for (const [index, entry] of cases.entries()) {
      const found = report[index];
      assert.equal(found.name, entry.name);
      if (entry.expect) {
        assert.deepEqual(found.issues, entry.expect, entry.name);
        assert.equal(found.rejected, false, entry.name);
      } else {
        assert.ok(entry.includes);
        assert.ok(found.issues.join("\n").includes(entry.includes), `${entry.name}: ${found.issues.join("\n")}`);
        assert.equal(found.rejected, true, entry.name);
      }
    }
  });

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

  test("round-trips quoted JSONC comment markers and escapes", () => {
    const expected = {
      "/* quoted key */": "literal /* keep me */ suffix",
      line: "https://example.com/path//literal",
      quote: 'escaped " quote /* still quoted */ // still quoted',
      backslash: "one \\ and two \\\\ before /* literal */",
      trailingBackslash: "ends with \\",
      markers: ["/*", "*/", "//", "/* outer /* inner */ tail */"],
    };
    const source = JSON.stringify(expected);
    assert.equal(stripJsonc(source), source);
    assert.deepEqual(parseWranglerJsonc(source), expected);
  });

  test("strips mixed JSONC comments only outside quoted strings", () => {
    const expected = { value: 'literal /* keep */ and " // keep', url: "https://example.com" };
    const source = `/* header with a quote " and // marker\r\nsecond line */\r\n{
      "value"/* between key and colon */: ${JSON.stringify(expected.value)}, // quote " and /* ignored
      "url": ${JSON.stringify(expected.url)} /* multiline comment
      with \\ and " and // markers */
    } // trailing comment without a newline`;
    assert.deepEqual(parseWranglerJsonc(source), expected);
    assert.deepEqual(
      stripJsonc(source).match(/[\r\n]/g),
      source.match(/[\r\n]/g),
    );
    assert.deepEqual(parseWranglerJsonc('{"value": 1 // CR-only comment\r}'), { value: 1 });
  });

  test("JSONC comments do not join invalid JSON tokens", () => {
    for (const source of ['{"value": 1/* separator */2}', '{"value": tr/* separator */ue}']) {
      assert.throws(() => parseWranglerJsonc(source), SyntaxError);
    }
    assert.throws(() => parseWranglerJsonc('{} /* unterminated comment'), SyntaxError);
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

  test("preserves combined gate diagnostics in order without mutating sources", () => {
    const config = JSON.parse(validWrangler);
    config.name = "wrong-worker";
    config.env.pre.vars.SITE_INDEXABLE = "1";
    config.triggers.crons = ["0 6 * * 0"];
    config.vars.DEPLOY_ENV = "pre";
    config.vars.STORAGE_READ_DRIVER = "r2";
    config.vars.R2_PUBLIC_BASE_URL = PREVIEW_R2_PUBLIC_BASE_URL;
    config.env.pre.r2_buckets.find((entry) => entry.binding === "DATA").bucket_name = PRODUCTION_R2_BUCKET;
    config.env.pre.vars.MIN_TRACKED_STARS = "1000";
    config.env.pre.vars.WORKFLOW_QUEUE_ENQUEUE_URL = PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL;
    const sources = Object.freeze(alignedSources({
      wranglerSource: JSON.stringify(config),
      runtimeConfigSource: validRuntime.replace(DEFAULT_CF_PREVIEW_ORIGIN, CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN),
      ciYml: validCi.replace(DEFAULT_CF_PREVIEW_ORIGIN, CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN)
        .replace("github.base_ref == 'pre'", "github.base_ref == 'main'"),
      deliveryYml: validDelivery.replace("checks: [static, production-build]", "checks: [static, production-build, cf-preview]"),
      deploySurfaceSource: 'wrangler deploy --env pre\ncurl -X PUT "https://example.com/schedules"',
      namingSources: Object.freeze({ "docs/OPS.md": "missing all canonical names" }),
    }));
    const before = structuredClone(sources);
    const expected = [
      "wrangler top-level name must be gitstarclub-web (production)",
      "wrangler env.pre must not enable SITE_INDEXABLE",
      "wrangler top-level triggers.crons must stay [] until Jason approves production CF Cron",
      "wrangler top-level triggers.crons must not use numeric weekday 0 or 7 (Cloudflare 1 = Sunday, 7 = Saturday, 0 rejected); use SUN or SAT",
      "wrangler env.pre r2_buckets DATA bucket_name must be gitstarclub-data-pre",
      "wrangler env.pre must not mention gitstarclub-data-prod",
      "wrangler top-level must not mention data-pre.gitstarclub.com",
      'wrangler top-level vars.DEPLOY_ENV must be unset until R2 cutover (received "pre")',
      'wrangler top-level vars.STORAGE_READ_DRIVER must be unset or blob until R2 cutover (received "r2")',
      "wrangler env.pre vars.MIN_TRACKED_STARS must equal production (10000)",
      "wrangler env.pre vars.WORKFLOW_QUEUE_ENQUEUE_URL must be https://pre.gitstarclub.com/enqueue",
      "DEFAULT_CF_PREVIEW_ORIGIN must not be the closed production workers.dev host",
      "DEFAULT_CF_PREVIEW_ORIGIN must be https://gitstarclub-web-pre.worldgo.workers.dev or https://pre.gitstarclub.com (received https://gitstarclub-web.worldgo.workers.dev)",
      "ci.yml CF_PREVIEW_ORIGIN fallback must not be the closed production workers.dev host",
      "refusing bare wrangler deploy (missing --dry-run): wrangler deploy --env pre",
      'refusing Cloudflare schedule mutation in repo automation: curl -X PUT "https://example.com/schedules"',
      ".delivery.yml ci.checks must not require cf-preview or cf-workers-host",
      "cf-preview must allowlist only github.ref_name == 'pre' or github.base_ref == 'pre'",
      "docs/OPS.md must name scripts/assert-cf-ci-gates.mjs",
      "docs/OPS.md must name preview Worker gitstarclub-web-pre",
      "docs/OPS.md must name production Worker gitstarclub-web",
    ];
    assert.deepEqual(assertCfCiGates(sources), expected);
    assert.deepEqual(assertCfCiGates(sources), expected);
    assert.deepEqual(sources, before);
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
    assert.equal(
      wrangler.r2_buckets.find((entry) => entry.binding === "DATA").bucket_name,
      PRODUCTION_R2_BUCKET,
    );
    assert.equal(wrangler.vars.MIN_TRACKED_STARS, undefined);
    assert.equal(wrangler.vars.PREFLIGHT_RELAX_EMPTY_SHARDS, undefined);
    assert.equal(wrangler.vars.WORKFLOW_COLD_START, undefined);
    assert.equal(wrangler.workers_dev, false);
    assert.equal(wrangler.preview_urls, false);
    assert.equal(wrangler.env.pre.workers_dev, true);
    assert.equal(wrangler.env.pre.preview_urls, true);
    assert.equal(wrangler.vars.BLOB_BASE_URL, undefined);
    assert.equal(wrangler.vars.NEXT_PUBLIC_BLOB_BASE_URL, undefined);
    assert.equal(wrangler.vars.CF_CRON_ORIGIN, PRODUCTION_CRON_ORIGIN);
    assert.equal(wrangler.vars.WORKFLOW_RUNTIME, PRODUCTION_WORKFLOW_RUNTIME);
    assert.equal(wrangler.vars.WORKFLOW_QUEUE_ENQUEUE_URL, PRODUCTION_WORKFLOW_QUEUE_ENQUEUE_URL);
    assert.equal(wrangler.vars.DEPLOY_ENV, "production");
    assert.equal(wrangler.vars.STORAGE_READ_DRIVER, "r2");
    assert.equal(wrangler.vars.READ_DRIVER, undefined);
    assert.equal(wrangler.vars.STORAGE_WRITE_DRIVER, "r2_binding");
    assert.equal(wrangler.vars.WRITE_DRIVER, undefined);
    assert.equal(wrangler.vars.R2_BUCKET, PRODUCTION_R2_BUCKET);
    assert.equal(wrangler.vars.R2_PUBLIC_BASE_URL, "https://data.gitstarclub.com");
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

  test("rejects wrong or missing preview storage drivers, bucket, and public base", () => {
    const cases = [
      {
        name: "missing read driver",
        mutate: (config) => {
          delete config.env.pre.vars.STORAGE_READ_DRIVER;
        },
        fragment: "STORAGE_READ_DRIVER must be r2",
      },
      {
        name: "blob read driver",
        mutate: (config) => {
          config.env.pre.vars.STORAGE_READ_DRIVER = "blob";
        },
        fragment: "STORAGE_READ_DRIVER must be r2",
      },
      {
        name: "missing write driver",
        mutate: (config) => {
          delete config.env.pre.vars.STORAGE_WRITE_DRIVER;
        },
        fragment: "STORAGE_WRITE_DRIVER must be r2_binding",
      },
      {
        name: "s3 write driver",
        mutate: (config) => {
          config.env.pre.vars.STORAGE_WRITE_DRIVER = "r2";
        },
        fragment: "STORAGE_WRITE_DRIVER must be r2_binding",
      },
      {
        name: "missing bucket var",
        mutate: (config) => {
          delete config.env.pre.vars.R2_BUCKET;
        },
        fragment: "R2_BUCKET must be gitstarclub-data-pre",
      },
      {
        name: "wrong bucket var",
        mutate: (config) => {
          config.env.pre.vars.R2_BUCKET = "gitstarclub-other";
        },
        fragment: "R2_BUCKET must be gitstarclub-data-pre",
      },
      {
        name: "missing public base",
        mutate: (config) => {
          delete config.env.pre.vars.R2_PUBLIC_BASE_URL;
        },
        fragment: "R2_PUBLIC_BASE_URL must be https://data-pre.gitstarclub.com",
      },
      {
        name: "wrong public base",
        mutate: (config) => {
          config.env.pre.vars.R2_PUBLIC_BASE_URL = "https://evil.example";
        },
        fragment: "R2_PUBLIC_BASE_URL must be https://data-pre.gitstarclub.com",
      },
    ];
    for (const entry of cases) {
      const config = JSON.parse(validWrangler);
      entry.mutate(config);
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(issues.some((issue) => issue.includes(entry.fragment)), `${entry.name}: ${issues.join("\n")}`);
    }
  });

  test("rejects cross-wired preview and production buckets and domains", () => {
    const previewBinding = JSON.parse(validWrangler);
    previewBinding.env.pre.r2_buckets.find((entry) => entry.binding === "DATA").bucket_name = PRODUCTION_R2_BUCKET;
    const bindingIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(previewBinding) }));
    assert.ok(
      bindingIssues.some((issue) => issue.includes(`DATA bucket_name must be ${PREVIEW_R2_BUCKET}`)),
      bindingIssues.join("\n"),
    );
    assert.ok(
      bindingIssues.some((issue) => issue.includes(`must not mention ${PRODUCTION_R2_BUCKET}`)),
      bindingIssues.join("\n"),
    );

    const previewBucket = JSON.parse(validWrangler);
    previewBucket.env.pre.vars.R2_BUCKET = PRODUCTION_R2_BUCKET;
    const previewBucketIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(previewBucket) }));
    assert.ok(
      previewBucketIssues.some((issue) => issue.includes(`must not mention ${PRODUCTION_R2_BUCKET}`)),
      previewBucketIssues.join("\n"),
    );
    assert.ok(
      previewBucketIssues.some((issue) => issue.includes(`R2_BUCKET must be ${PREVIEW_R2_BUCKET}`)),
      previewBucketIssues.join("\n"),
    );

    const previewDomain = JSON.parse(validWrangler);
    previewDomain.env.pre.vars.R2_PUBLIC_BASE_URL = `https://${PRODUCTION_R2_PUBLIC_HOST}`;
    const previewDomainIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(previewDomain) }));
    assert.ok(
      previewDomainIssues.some((issue) => issue.includes(`must not mention ${PRODUCTION_R2_PUBLIC_HOST}`)),
      previewDomainIssues.join("\n"),
    );
    assert.ok(
      previewDomainIssues.some((issue) =>
        issue.includes(`R2_PUBLIC_BASE_URL must be ${PREVIEW_R2_PUBLIC_BASE_URL}`),
      ),
      previewDomainIssues.join("\n"),
    );

    const topBucket = JSON.parse(validWrangler);
    topBucket.vars.NOTE = PREVIEW_R2_BUCKET;
    const topBucketIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(topBucket) }));
    assert.ok(
      topBucketIssues.some((issue) => issue.includes(`top-level must not mention ${PREVIEW_R2_BUCKET}`)),
      topBucketIssues.join("\n"),
    );

    const topDomain = JSON.parse(validWrangler);
    topDomain.vars.R2_PUBLIC_BASE_URL = PREVIEW_R2_PUBLIC_BASE_URL;
    const topDomainIssues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(topDomain) }));
    assert.ok(
      topDomainIssues.some((issue) => issue.includes(`top-level must not mention ${PREVIEW_R2_PUBLIC_HOST}`)),
      topDomainIssues.join("\n"),
    );
  });

  test("rejects top-level DEPLOY_ENV and non-blob drivers before R2 cutover", () => {
    const cases = [
      ["DEPLOY_ENV", "pre", "top-level vars.DEPLOY_ENV must be unset until R2 cutover"],
      ["DEPLOY_ENV", "production", "top-level vars.STORAGE_READ_DRIVER must be r2"],
      ["STORAGE_READ_DRIVER", "r2", "top-level vars.STORAGE_READ_DRIVER must be unset or blob"],
      ["STORAGE_READ_DRIVER", "r2_then_blob", "top-level vars.STORAGE_READ_DRIVER must be unset or blob"],
      ["READ_DRIVER", "r2", "top-level vars.READ_DRIVER must be unset or blob"],
      ["STORAGE_WRITE_DRIVER", "r2_binding", "top-level vars.STORAGE_WRITE_DRIVER must be unset or blob"],
      ["WRITE_DRIVER", "r2_s3", "top-level vars.WRITE_DRIVER must be unset or blob"],
    ];
    for (const [key, value, fragment] of cases) {
      const config = JSON.parse(validWrangler);
      config.vars[key] = value;
      const issues = assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(config) }));
      assert.ok(issues.some((issue) => issue.includes(fragment)), `${key}=${value}: ${issues.join("\n")}`);
    }

    const explicitBlob = JSON.parse(validWrangler);
    explicitBlob.vars.STORAGE_READ_DRIVER = "blob";
    explicitBlob.vars.STORAGE_WRITE_DRIVER = " Blob ";
    explicitBlob.vars.READ_DRIVER = "";
    assert.deepEqual(assertCfCiGates(alignedSources({ wranglerSource: JSON.stringify(explicitBlob) })), []);
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
        name: "ipv6 loopback fixture",
        input: {
          target: "production",
          shell: { BLOB_BASE_URL: "http://[::1]:4010" },
          wrangler,
        },
        expect: [],
      },
      {
        name: "ipv6 loopback fixture on preview",
        input: {
          target: "pre",
          shell: { R2_PUBLIC_BASE_URL: "http://[::1]:4010/" },
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
