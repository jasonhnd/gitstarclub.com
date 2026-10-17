// @ts-nocheck -- Bun's test globals are intentionally outside the production JS typecheck roots.
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  formatRemotePlan,
  parseBootstrapArgs,
  preflightR2Identity,
  remoteWriteEnabled,
  resolveR2BucketName,
  resolveR2Location,
  runRemoteStage,
} from "./bootstrap-cli.mjs";
import { renderExtractSql } from "./extract-sql.mjs";
import { readFileSync } from "node:fs";

const pipelineDir = fileURLToPath(new URL("..", import.meta.url));
const SECRET = "test-secret-not-printed";

function r2Env(overrides = {}) {
  return {
    R2_ACCESS_KEY_ID: "test-access-key",
    R2_SECRET_ACCESS_KEY: SECRET,
    R2_BUCKET_PRE: "gitstarclub-data-pre",
    R2_BUCKET_PROD: "gitstarclub-data-prod",
    R2_ACCOUNT_ID: "00112233445566778899aabbccddeeff",
    ...overrides,
  };
}

describe("bootstrap CLI", () => {
  test("an executed remote stage retains its structured result", async () => {
    const cli = parseBootstrapArgs(["--store", "r2", "--target", "pre", "--execute"]);
    const result = { phase: "base", objects: 2, digests: ["one", "two"] };
    const requests = [];
    const outcome = await runRemoteStage({
      cli,
      env: r2Env(),
      fetch: async (_input, init) => {
        requests.push(init.method);
        return new Response(JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: "pre" }));
      },
      stage: async (store) => {
        await store.checkIdentity();
        return result;
      },
    });
    expect(outcome.action).toBe("wrote");
    expect(outcome.result).toBe(result);
    expect(requests).toEqual(["GET"]);
  });

  test("R2 without --execute performs zero write requests and Blob still writes", async () => {
    const cli = parseBootstrapArgs(["--store", "r2", "--target", "pre", "--generation", "bootstrap-20260717T120000Z"]);
    expect(remoteWriteEnabled(cli)).toBe(false);
    const requests = [];
    const outcome = await runRemoteStage({
      cli,
      env: r2Env(),
      fetch: async () => {
        requests.push("fetch");
        throw new Error("dry-run must not call fetch");
      },
      stage: async () => {
        throw new Error("dry-run must not stage");
      },
    });
    expect(outcome.action).toBe("dry-run");
    expect(requests).toHaveLength(0);
    expect(formatRemotePlan({ objects: 3, bytes: 9, cli, bucket: "gitstarclub-data-pre" })).toContain(
      "bucket=gitstarclub-data-pre",
    );
    expect(formatRemotePlan({ objects: 3, bytes: 9, cli, bucket: "gitstarclub-data-pre" })).toContain("writes=0");

    const blob = parseBootstrapArgs(["--generation", "bootstrap-20260717T120000Z"]);
    expect(blob.store).toBe("blob");
    expect(remoteWriteEnabled(blob)).toBe(true);
    expect(remoteWriteEnabled(parseBootstrapArgs(["--generation", "bootstrap-20260717T120000Z", "--dry-run"]))).toBe(false);
  });

  test("bucket selection checks a single R2_BUCKET against --target and hides secrets", () => {
    expect(resolveR2BucketName(r2Env(), "pre")).toBe("gitstarclub-data-pre");
    expect(resolveR2BucketName(r2Env(), "prod")).toBe("gitstarclub-data-prod");
    expect(resolveR2BucketName({ R2_BUCKET: "gitstarclub-data-pre" }, "pre")).toBe("gitstarclub-data-pre");
    expect(() => resolveR2BucketName({ R2_BUCKET: "gitstarclub-data-pre", R2_SECRET_ACCESS_KEY: SECRET }, "prod")).toThrow(
      /does not match --target prod/,
    );
    try {
      resolveR2BucketName({ R2_BUCKET: "gitstarclub-data-pre", R2_SECRET_ACCESS_KEY: SECRET }, "prod");
    } catch (error) {
      expect(error.message).not.toContain(SECRET);
    }
    expect(() =>
      resolveR2BucketName({ R2_BUCKET: "other", R2_BUCKET_PROD: "gitstarclub-data-prod" }, "prod"),
    ).toThrow(/does not match R2_BUCKET_PROD/);
    const location = resolveR2Location(r2Env(), "prod");
    expect(location.endpoint).toBe("https://00112233445566778899aabbccddeeff.r2.cloudflarestorage.com");
    expect(location.bucket).toBe("gitstarclub-data-prod");
    expect(() => parseBootstrapArgs(["--store", "r2", "--generation", "bootstrap-20260717T120000Z"])).toThrow(
      /requires --target/,
    );
    expect(() => parseBootstrapArgs(["--initial-commit", "--generation", "bootstrap-20260717T120000Z"])).toThrow(
      /requires --store r2/,
    );
    expect(() => parseBootstrapArgs(["--target", "prod", "--generation", "bootstrap-abc"])).toThrow(
      /--target requires --store r2/,
    );
    expect(() => parseBootstrapArgs(["--target", "pre", "--generation", "bootstrap-abc", "--execute"])).toThrow(
      /--target requires --store r2/,
    );
    expect(() => parseBootstrapArgs(["--excute"])).toThrow(/unknown argument --excute/);
    expect(parseBootstrapArgs(["--help", "--bogus"]).help).toBe(true);
  });

  test("R2 dry-run identity preflight is a single GET and is skipped without credentials", async () => {
    const cli = parseBootstrapArgs(["--store", "r2", "--target", "pre", "--generation", "bootstrap-20260717T120000Z"]);
    const requests = [];
    const skipped = await preflightR2Identity(
      cli,
      { R2_BUCKET_PRE: "gitstarclub-data-pre" },
      {
        fetch: async () => {
          requests.push("fetch");
          throw new Error("unset credentials must not fetch");
        },
      },
    );
    expect(skipped.checked).toBe(false);
    expect(requests).toHaveLength(0);

    const identity = JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: "pre" });
    const checked = await preflightR2Identity(cli, r2Env(), {
      now: () => new Date("2026-07-17T00:00:00.000Z"),
      fetch: async (input, init) => {
        const method = init?.method ?? "GET";
        requests.push(method);
        const url = String(input);
        if (method !== "GET" || !url.includes("_meta/bucket-identity.json")) {
          throw new Error(`unexpected ${method}`);
        }
        return new Response(identity, { status: 200, headers: { etag: '"id"' } });
      },
    });
    expect(checked.checked).toBe(true);
    expect(requests).toEqual(["GET"]);
    expect(requests.join(" ")).not.toContain(SECRET);
  });

  test("06 and 07 help document the R2 flags", () => {
    const env = { PATH: "/usr/bin:/bin", HOME: "/tmp", TMPDIR: "/tmp" };
    for (const script of ["backfill/06-upload.mjs", "backfill/07-export-v2.mjs"]) {
      const result = spawnSync(process.execPath, [script, "--help"], { cwd: pipelineDir, encoding: "utf8", env });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("--store");
      expect(result.stdout).toContain("--target");
      expect(result.stdout).toContain("--execute");
      expect(result.stdout).not.toContain(SECRET);
    }
    const exportHelp = spawnSync(process.execPath, ["backfill/07-export-v2.mjs", "--help"], {
      cwd: pipelineDir,
      encoding: "utf8",
      env,
    });
    expect(exportHelp.stdout).toContain("--initial-commit");
    expect(exportHelp.stdout).toContain("--rollback");
  });
});

describe("extract SQL parameters", () => {
  const template = readFileSync(new URL("../backfill/02-extract.sql", import.meta.url), "utf8");

  test("renders a dated table and refuses the unsuffixed May table", () => {
    const sql = renderExtractSql(template, {
      cutoffSuffix: "260531",
      destination: "gitstarclub.star_daily_gross_260531",
    });
    expect(sql).toContain("CREATE OR REPLACE TABLE `gitstarclub.star_daily_gross_260531`");
    expect(sql).toContain("AND '260531'");
    expect(sql).not.toContain("@@DESTINATION_TABLE@@");
    expect(sql).not.toContain("@@CUTOFF_SUFFIX@@");
    expect(sql).toContain("--maximum_bytes_billed=400000000000");
    expect(() => renderExtractSql(template, { cutoffSuffix: "260531", destination: "gitstarclub.star_daily_gross" })).toThrow(
      /refusing to overwrite/,
    );
    expect(() => renderExtractSql(template, { cutoffSuffix: "260531", destination: "gitstarclub.whitelist" })).toThrow(
      /star_daily_gross_<suffix>/,
    );
    expect(() => renderExtractSql(template, { cutoffSuffix: "20260531", destination: "gitstarclub.star_daily_gross_x" })).toThrow(
      /6-digit/,
    );
  });
});
