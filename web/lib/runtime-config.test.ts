import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertR2WritesAllowed,
  getBlobBaseUrl,
  getBlobWriteToken,
  getGithubToken,
  getPublicReadBases,
  getR2KeyPrefix,
  getStorageReadDriver,
  getStorageWriteDriver,
  getCacheInvalidationKind,
  getCfPreviewOrigin,
  getCfPreviewRequireSha,
  getPreviewTarget,
  getWorkflowQueueEnqueueUrl,
  getWorkflowRuntimeKind,
  getWorkflowStepBaseUrl,
  assertCacheInvalidationAllowed,
  assertPreviewTargetAllowed,
  DEFAULT_CF_PREVIEW_ORIGIN,
  requireBlobBaseUrl,
  requireBlobWriteToken,
  requireCronSecret,
  requireGithubToken,
  requireWorkflowQueueEnqueueUrl,
} from "./runtime-config";

const originalEnv = {
  BLOB_BASE_URL: process.env.BLOB_BASE_URL,
  NEXT_PUBLIC_BLOB_BASE_URL: process.env.NEXT_PUBLIC_BLOB_BASE_URL,
  BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  STORAGE_READ_DRIVER: process.env.STORAGE_READ_DRIVER,
  STORAGE_WRITE_DRIVER: process.env.STORAGE_WRITE_DRIVER,
  READ_DRIVER: process.env.READ_DRIVER,
  WRITE_DRIVER: process.env.WRITE_DRIVER,
  R2_PREFIX: process.env.R2_PREFIX,
  R2_PUBLIC_BASE_URL: process.env.R2_PUBLIC_BASE_URL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

const STORAGE_KEYS = Object.keys(originalEnv) as Array<keyof typeof originalEnv>;

beforeEach(() => {
  for (const key of STORAGE_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of STORAGE_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("runtime config getters", () => {
  test("normalizes Blob base URL and falls back to the public var", () => {
    process.env.NEXT_PUBLIC_BLOB_BASE_URL = "https://public.example.com/";
    expect(getBlobBaseUrl()).toBe("https://public.example.com");

    process.env.BLOB_BASE_URL = "https://private.example.com///";
    expect(getBlobBaseUrl()).toBe("https://private.example.com");
  });

  test("reads Blob and GitHub tokens at call time", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "blob-a";
    process.env.GITHUB_TOKEN = "gh-a";
    expect(getBlobWriteToken()).toBe("blob-a");
    expect(getGithubToken()).toBe("gh-a");

    process.env.BLOB_READ_WRITE_TOKEN = "blob-b";
    process.env.GITHUB_TOKEN = "gh-b";
    expect(requireBlobWriteToken()).toBe("blob-b");
    expect(requireGithubToken()).toBe("gh-b");
  });

  test("required config helpers fail clearly when values are missing", () => {
    expect(() => requireBlobBaseUrl()).toThrow("BLOB_BASE_URL not set");
    expect(() => requireBlobWriteToken()).toThrow("BLOB_READ_WRITE_TOKEN not set");
    expect(() => requireGithubToken()).toThrow("GITHUB_TOKEN not set");
  });

  test("fresh-clone read-only configuration does not require a write token", () => {
    const readOnlyEnv = { BLOB_BASE_URL: "https://blob.example.com" };

    expect(requireBlobBaseUrl(readOnlyEnv)).toBe("https://blob.example.com");
    expect(getBlobWriteToken(readOnlyEnv)).toBeUndefined();
  });
});

describe("storage driver config", () => {
  test("defaults read and write drivers to blob", () => {
    expect(getStorageReadDriver()).toBe("blob");
    expect(getStorageWriteDriver()).toBe("blob");
    expect(getR2KeyPrefix()).toBe("migrate-dev/");
  });

  test("accepts READ_DRIVER / WRITE_DRIVER aliases", () => {
    expect(getStorageReadDriver({ READ_DRIVER: "r2_then_blob" })).toBe("r2_then_blob");
    expect(getStorageWriteDriver({ WRITE_DRIVER: "r2" })).toBe("r2");
  });

  test("public reads stay on Blob unless an R2 public base is configured", () => {
    expect(getPublicReadBases({ BLOB_BASE_URL: "https://blob.example.com" })).toEqual([
      "https://blob.example.com",
    ]);
    expect(
      getPublicReadBases({
        STORAGE_READ_DRIVER: "r2_then_blob",
        BLOB_BASE_URL: "https://blob.example.com",
        R2_PUBLIC_BASE_URL: "https://r2.example.com/",
      }),
    ).toEqual(["https://r2.example.com", "https://blob.example.com"]);
  });

  test("refuses production R2 writes and empty/root prefixes", () => {
    expect(() => assertR2WritesAllowed({ VERCEL_ENV: "production", R2_PREFIX: "migrate-dev/" })).toThrow(
      "VERCEL_ENV=production",
    );
    expect(() => assertR2WritesAllowed({ R2_PREFIX: "" })).toThrow("non-production");
    expect(() => assertR2WritesAllowed({ R2_PREFIX: "views/" })).toThrow("non-production");
    expect(() => assertR2WritesAllowed({ R2_PREFIX: "migrate-dev/" })).not.toThrow();
  });
});

describe("workflow runtime config", () => {
  test("defaults the refresh runtime to http", () => {
    expect(getWorkflowRuntimeKind({})).toBe("http");
    expect(getWorkflowRuntimeKind({ WORKFLOW_RUNTIME: "cf-queue" })).toBe("cf-queue");
    expect(() => getWorkflowRuntimeKind({ WORKFLOW_RUNTIME: "vercel-workflow" })).toThrow("WORKFLOW_RUNTIME");
  });

  test("requires a queue enqueue URL only for the CF adapter", () => {
    expect(getWorkflowQueueEnqueueUrl({})).toBeUndefined();
    expect(() => requireWorkflowQueueEnqueueUrl({})).toThrow("WORKFLOW_QUEUE_ENQUEUE_URL");
    expect(requireWorkflowQueueEnqueueUrl({ WORKFLOW_QUEUE_ENQUEUE_URL: "https://worker.example/enqueue" })).toBe(
      "https://worker.example/enqueue",
    );
  });

  test("derives the step base URL from VERCEL_URL when unset", () => {
    expect(getWorkflowStepBaseUrl({ VERCEL_URL: "pre.example.vercel.app" })).toBe("https://pre.example.vercel.app");
    expect(getWorkflowStepBaseUrl({ WORKFLOW_STEP_BASE_URL: "https://pre.gitstarclub.com/" })).toBe(
      "https://pre.gitstarclub.com",
    );
    expect(() => requireCronSecret({})).toThrow("CRON_SECRET not set");
  });
});

describe("P2 cache-invalidation and preview config", () => {
  test("defaults cache invalidation and preview target to Vercel", () => {
    expect(getCacheInvalidationKind({})).toBe("vercel");
    expect(getPreviewTarget({})).toBe("vercel");
    expect(getCfPreviewOrigin({})).toBe(DEFAULT_CF_PREVIEW_ORIGIN);
    expect(getCfPreviewOrigin({ CF_PREVIEW_ORIGIN: "https://example.workers.dev/" })).toBe(
      "https://example.workers.dev",
    );
    expect(getCfPreviewRequireSha({})).toBe(false);
    expect(getCfPreviewRequireSha({ CF_PREVIEW_REQUIRE_SHA: "1" })).toBe(true);
  });

  test("refuses CF-only drivers as the production source of truth", () => {
    expect(() => assertCacheInvalidationAllowed({ CACHE_INVALIDATION_DRIVER: "cf-stub", VERCEL_ENV: "production" })).toThrow(
      "CACHE_INVALIDATION_DRIVER",
    );
    expect(() => assertPreviewTargetAllowed({ PREVIEW_TARGET: "cf", VERCEL_ENV: "production" })).toThrow("PREVIEW_TARGET");
    expect(() => assertCacheInvalidationAllowed({ VERCEL_ENV: "production" })).not.toThrow();
    expect(() => assertPreviewTargetAllowed({ VERCEL_ENV: "production" })).not.toThrow();
  });
});
