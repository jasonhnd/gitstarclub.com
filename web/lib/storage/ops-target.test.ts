import { describe, expect, test } from "bun:test";
import { describeStorageDrivers } from "./object-store";
import {
  applyOpsSelection,
  bucketMatchesTarget,
  deployEnvForTarget,
  firstPositional,
  opsCredentialsPresent,
  opsEnvKeys,
  assertPublicReadMatchesTarget,
  publicReadBaseForOps,
  readOpsProcessEnv,
  resolveOpsBucketName,
  splitConfirmArg,
  takeOpsFlags,
} from "./ops-target";

describe("ops target selection", () => {
  test("requires --target for r2 and leaves script flags in place", () => {
    expect(() => takeOpsFlags(["--store", "r2"])).toThrow(/--target prod\|pre/);
    const parsed = takeOpsFlags([
      "--store",
      "r2",
      "--target",
      "pre",
      "--execute",
      "--confirm",
      "views/verify-123/",
      "views/verify-123/",
    ]);
    expect(parsed.selection).toEqual({ store: "r2", target: "pre" });
    expect(parsed.rest).toEqual(["--execute", "--confirm", "views/verify-123/", "views/verify-123/"]);
  });

  test("blob ignores a missing target and rejects a bad store", () => {
    expect(takeOpsFlags(["--week", "2026-W27"]).selection).toEqual({ store: "blob", target: null });
    expect(() => takeOpsFlags(["--store", "s3"])).toThrow(/blob or r2/);
    expect(() => takeOpsFlags(["--store", "r2", "--target", "local"])).toThrow(/prod or pre/);
    expect(() => takeOpsFlags(["--target", "prod"])).toThrow(/requires --store r2/);
    expect(() => takeOpsFlags(["--target", "pre", "--execute"])).toThrow(/requires --store r2/);
    expect(() => takeOpsFlags(["--target", "local"])).toThrow(/requires --store r2/);
  });

  test("bucket names follow the target and do not echo secrets", () => {
    const secret = "test-secret-not-printed";
    expect(resolveOpsBucketName({ R2_BUCKET_PRE: "gitstarclub-data-pre" }, "pre")).toBe("gitstarclub-data-pre");
    expect(resolveOpsBucketName({ R2_BUCKET_PROD: "gitstarclub-data-prod", R2_BUCKET: "gitstarclub-data-prod" }, "prod")).toBe(
      "gitstarclub-data-prod",
    );
    expect(resolveOpsBucketName({ R2_BUCKET: "gitstarclub-data-pre" }, "pre")).toBe("gitstarclub-data-pre");
    expect(bucketMatchesTarget("gitstarclub-data-prod", "prod")).toBe(true);
    expect(bucketMatchesTarget("gitstarclub-data-pre", "prod")).toBe(false);
    expect(deployEnvForTarget("prod")).toBe("production");
    expect(deployEnvForTarget("pre")).toBe("pre");
    expect(() =>
      resolveOpsBucketName({ R2_BUCKET: "gitstarclub-data-pre", R2_SECRET_ACCESS_KEY: secret }, "prod"),
    ).toThrow(/does not match --target prod/);
    try {
      resolveOpsBucketName({ R2_BUCKET: "gitstarclub-data-pre", R2_SECRET_ACCESS_KEY: secret }, "prod");
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
    expect(() =>
      resolveOpsBucketName({ R2_BUCKET_PROD: "gitstarclub-data-prod", R2_BUCKET: "other" }, "prod"),
    ).toThrow(/does not match R2_BUCKET_PROD/);
  });

  test("applyOpsSelection forces blob or r2_s3 on the env object", () => {
    const blobEnv = {
      STORAGE_READ_DRIVER: "r2_s3",
      STORAGE_WRITE_DRIVER: "r2_s3",
      R2_BUCKET: "gitstarclub-data-pre",
    };
    applyOpsSelection(blobEnv, { store: "blob", target: null });
    expect(describeStorageDrivers(blobEnv)).toEqual({ read: "blob", write: "blob" });

    const r2Env = { R2_BUCKET_PRE: "gitstarclub-data-pre", STORAGE_WRITE_DRIVER: "blob" };
    applyOpsSelection(r2Env, { store: "r2", target: "pre" });
    expect(r2Env).toMatchObject({
      STORAGE_READ_DRIVER: "r2_s3",
      STORAGE_WRITE_DRIVER: "r2_s3",
      DEPLOY_ENV: "pre",
      R2_BUCKET: "gitstarclub-data-pre",
      R2_PREFIX: "",
    });
    expect(describeStorageDrivers(r2Env)).toEqual({ read: "r2_s3", write: "r2_s3" });
  });

  test("public base, credential presence, and env key allowlists stay store-specific", () => {
    expect(publicReadBaseForOps({ BLOB_BASE_URL: "https://blob.example.com/" }, { store: "blob", target: null })).toBe(
      "https://blob.example.com",
    );
    expect(publicReadBaseForOps({ R2_PUBLIC_BASE_URL: "https://r2.example.com" }, { store: "r2", target: "pre" })).toBe(
      "https://r2.example.com",
    );
    expect(
      publicReadBaseForOps(
        { R2_PUBLIC_BASE_URL: "https://generic.example", R2_PUBLIC_BASE_URL_PRE: "https://pre.example/" },
        { store: "r2", target: "pre" },
      ),
    ).toBe("https://pre.example");
    expect(
      publicReadBaseForOps(
        { R2_PUBLIC_BASE_URL: "https://generic.example", R2_PUBLIC_BASE_URL_PROD: "https://prod.example" },
        { store: "r2", target: "prod" },
      ),
    ).toBe("https://prod.example");
    expect(() => publicReadBaseForOps({}, { store: "blob", target: null })).toThrow(/BLOB_BASE_URL not set/);
    expect(() => publicReadBaseForOps({}, { store: "r2", target: "prod" })).toThrow(/R2_PUBLIC_BASE_URL not set/);
    expect(opsEnvKeys({ store: "blob", target: null }, false)).not.toContain("BLOB_READ_WRITE_TOKEN");
    expect(opsEnvKeys({ store: "r2", target: "pre" }, false)).not.toContain("R2_SECRET_ACCESS_KEY");
    expect(opsEnvKeys({ store: "r2", target: "pre" }, true)).toContain("R2_SECRET_ACCESS_KEY");
    expect(opsCredentialsPresent({ BLOB_READ_WRITE_TOKEN: "present" }, { store: "blob", target: null })).toBe(true);
    expect(
      opsCredentialsPresent(
        {
          R2_ACCESS_KEY_ID: "id",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_ACCOUNT_ID: "account",
          R2_BUCKET_PRE: "gitstarclub-data-pre",
        },
        { store: "r2", target: "pre" },
      ),
    ).toBe(true);
    expect(opsCredentialsPresent({}, { store: "r2", target: "pre" })).toBe(false);
    expect(Object.keys(readOpsProcessEnv()).sort()).toEqual([
      "AWS_S3_BUCKET",
      "R2_BUCKET",
      "R2_BUCKET_PRE",
      "R2_BUCKET_PROD",
      "R2_PUBLIC_BASE_URL_PRE",
      "R2_PUBLIC_BASE_URL_PROD",
    ]);
  });

  test("R2 public identity must match the target and Blob does not fetch", async () => {
    const env = { R2_PUBLIC_BASE_URL_PRE: "https://pre.example", R2_BUCKET_PRE: "gitstarclub-data-pre" };
    const selection = { store: "r2" as const, target: "pre" as const };
    const calls: Array<{ url: string; cache: RequestCache | undefined }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit) => {
      calls.push({ url: String(input), cache: init?.cache });
      return new Response(JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: "pre" }), { status: 200 });
    };
    expect(await assertPublicReadMatchesTarget(env, selection, fetchImpl)).toBe("https://pre.example");
    expect(calls).toEqual([{ url: "https://pre.example/_meta/bucket-identity.json", cache: "no-store" }]);

    await expect(
      assertPublicReadMatchesTarget(env, selection, async () =>
        new Response(JSON.stringify({ bucket: "gitstarclub-data-prod", deploy_env: "production" }), { status: 200 }),
      ),
    ).rejects.toThrow(/does not match target "gitstarclub-data-pre"/);
    await expect(
      assertPublicReadMatchesTarget(env, selection, async () =>
        new Response(JSON.stringify({ bucket: "gitstarclub-data-pre", deploy_env: "production" }), { status: 200 }),
      ),
    ).rejects.toThrow(/deploy_env=production/);
    await expect(
      assertPublicReadMatchesTarget(env, selection, async () => new Response("missing", { status: 404 })),
    ).rejects.toThrow(/unreadable \(404\)/);
    await expect(
      assertPublicReadMatchesTarget(env, selection, async () => new Response("not-json", { status: 200 })),
    ).rejects.toThrow(/not JSON/);
    await expect(
      assertPublicReadMatchesTarget(env, selection, async () => {
        throw new Error("offline");
      }),
    ).rejects.toThrow(/unreadable \(offline\)/);

    const blobCalls: string[] = [];
    expect(
      await assertPublicReadMatchesTarget({ BLOB_BASE_URL: "https://blob.example.com" }, { store: "blob", target: null }, async () => {
        blobCalls.push("fetch");
        throw new Error("blob must not fetch");
      }),
    ).toBe("https://blob.example.com");
    expect(blobCalls).toHaveLength(0);
  });

  test("confirm values are not treated as the positional prefix", () => {
    const argv = ["--execute", "--confirm", "views/verify-123/", "views/verify-123/"];
    expect(splitConfirmArg(argv)).toEqual({
      confirm: "views/verify-123/",
      positional: ["--execute", "views/verify-123/"],
    });
    expect(firstPositional(argv)).toBe("views/verify-123/");
    expect(firstPositional(["--confirm=views/verify-123/", "--dry-run"])).toBeUndefined();
    expect(() => splitConfirmArg(["--confirm"])).toThrow(/--confirm requires a value/);
  });
});
