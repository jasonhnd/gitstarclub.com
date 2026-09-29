import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  assertR2WritesAllowed,
  getBlobBaseUrl,
  getBlobWriteToken,
  getViewsVersionFallback,
  resetViewsVersionFallbackLogForTests,
  getGithubToken,
  getPublicReadBases,
  getR2KeyPrefix,
  getStorageReadDriver,
  getStorageWriteDriver,
  getCacheInvalidationKind,
  getCfPreviewOrigin,
  getCfPreviewRequireSha,
  getHostingTarget,
  getMinTrackedStars,
  getWhitelistSearchHopBudgetMs,
  isWhitelistSearchSharded,
  getDeployEnv,
  isProductionDeployment,
  isPreviewPreflightEmptyShardRelaxed,
  isWorkflowColdStartEnabled,
  resetBucketIdentityCacheForTests,
  DEFAULT_WHITELIST_SEARCH_HOP_BUDGET_MS,
  getPreviewTarget,
  isCloudflareWorkersHost,
  runWithCloudflareWorkersHostForTests,
  getWorkflowQueueEnqueueUrl,
  getWorkflowRuntimeKind,
  getWorkflowStepBaseUrl,
  assertCacheInvalidationAllowed,
  assertPreviewTargetAllowed,
  assertHostingTargetAllowed,
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
  VIEWS_VERSION_FALLBACK: process.env.VIEWS_VERSION_FALLBACK,
  DEPLOY_ENV: process.env.DEPLOY_ENV,
  HOSTING_TARGET: process.env.HOSTING_TARGET,
  WORKFLOW_COLD_START: process.env.WORKFLOW_COLD_START,
  PREFLIGHT_RELAX_EMPTY_SHARDS: process.env.PREFLIGHT_RELAX_EMPTY_SHARDS,
};

const STORAGE_KEYS = Object.keys(originalEnv) as Array<keyof typeof originalEnv>;

beforeEach(() => {
  for (const key of STORAGE_KEYS) delete process.env[key];
  resetBucketIdentityCacheForTests();
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

  test("VIEWS_VERSION_FALLBACK accepts only a refresh version id", () => {
    resetViewsVersionFallbackLogForTests();
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      expect(getViewsVersionFallback({})).toBeNull();
      expect(getViewsVersionFallback({ VIEWS_VERSION_FALLBACK: "" })).toBeNull();
      expect(getViewsVersionFallback({ VIEWS_VERSION_FALLBACK: "refresh-2026-09-13T06-00-16-398Z" })).toBe(
        "refresh-2026-09-13T06-00-16-398Z",
      );
      expect(warnings).toEqual([]);

      expect(getViewsVersionFallback({ VIEWS_VERSION_FALLBACK: "latest" })).toBeNull();
      expect(getViewsVersionFallback({ VIEWS_VERSION_FALLBACK: "refresh-2026-09-13T06-00-16-398" })).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(String(warnings[0]?.[0])).toContain("ignoring VIEWS_VERSION_FALLBACK");
    } finally {
      console.warn = originalWarn;
    }
  });

  test("VIEWS_VERSION_FALLBACK is read from the Worker env at call time", () => {
    delete process.env.VIEWS_VERSION_FALLBACK;
    expect(getViewsVersionFallback()).toBeNull();
    expect(getViewsVersionFallback({ VIEWS_VERSION_FALLBACK: "refresh-2026-01-01T00-00-00-000Z" })).toBe(
      "refresh-2026-01-01T00-00-00-000Z",
    );

    process.env.VIEWS_VERSION_FALLBACK = "refresh-2026-09-13T06-00-16-398Z";
    expect(getViewsVersionFallback()).toBe("refresh-2026-09-13T06-00-16-398Z");
    expect(getViewsVersionFallback({})).toBeNull();
  });

  test("MIN_TRACKED_STARS defaults to 10000 and resolves at call time", () => {
    expect(getMinTrackedStars({})).toBe(10_000);
    expect(getMinTrackedStars({ MIN_TRACKED_STARS: "1000" })).toBe(1_000);
    expect(getMinTrackedStars({ MIN_TRACKED_STARS: " 1000 " })).toBe(1_000);
    expect(() => getMinTrackedStars({ MIN_TRACKED_STARS: "1e3" })).toThrow("positive integer");
    expect(() => getMinTrackedStars({ MIN_TRACKED_STARS: "0" })).toThrow("positive integer");
  });

  test("PREFLIGHT_RELAX_EMPTY_SHARDS arms only for DEPLOY_ENV=pre", () => {
    expect(isPreviewPreflightEmptyShardRelaxed({})).toBe(false);
    expect(isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "0", DEPLOY_ENV: "pre" })).toBe(false);
    expect(isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "true", DEPLOY_ENV: "pre" })).toBe(false);
    expect(isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1" })).toBe(false);
    expect(isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", DEPLOY_ENV: "pre" })).toBe(true);
    expect(isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", DEPLOY_ENV: "production" })).toBe(
      false,
    );
    expect(
      isPreviewPreflightEmptyShardRelaxed({ PREFLIGHT_RELAX_EMPTY_SHARDS: "1", HOSTING_TARGET: "cf" }),
    ).toBe(false);
    expect(
      isPreviewPreflightEmptyShardRelaxed({
        PREFLIGHT_RELAX_EMPTY_SHARDS: "1",
        DEPLOY_ENV: "pre",
        VERCEL_ENV: "production",
      }),
    ).toBe(false);
  });

  test("WORKFLOW_COLD_START arms only for DEPLOY_ENV=pre", () => {
    expect(isWorkflowColdStartEnabled({})).toBe(false);
    expect(isWorkflowColdStartEnabled({ WORKFLOW_COLD_START: "1" })).toBe(false);
    expect(isWorkflowColdStartEnabled({ WORKFLOW_COLD_START: "1", DEPLOY_ENV: "pre" })).toBe(true);
    expect(isWorkflowColdStartEnabled({ WORKFLOW_COLD_START: "1", DEPLOY_ENV: "production" })).toBe(false);
    expect(isWorkflowColdStartEnabled({ WORKFLOW_COLD_START: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(isWorkflowColdStartEnabled({ WORKFLOW_COLD_START: "1", HOSTING_TARGET: "cf" })).toBe(false);
  });

  test("DEPLOY_ENV is production, pre, or local", () => {
    expect(getDeployEnv({})).toBeNull();
    expect(getDeployEnv({ DEPLOY_ENV: " Pre " })).toBe("pre");
    expect(isProductionDeployment({})).toBe(false);
    expect(isProductionDeployment({ DEPLOY_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ DEPLOY_ENV: "pre" })).toBe(false);
    expect(isProductionDeployment({ VERCEL_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ DEPLOY_ENV: "local" })).toBe(false);
    expect(() => getDeployEnv({ DEPLOY_ENV: "staging" })).toThrow("production | pre | local");
  });

  test("WHITELIST_SEARCH_SHARDS is off unless exactly 1", () => {
    expect(isWhitelistSearchSharded({})).toBe(false);
    expect(isWhitelistSearchSharded({ WHITELIST_SEARCH_SHARDS: "0" })).toBe(false);
    expect(isWhitelistSearchSharded({ WHITELIST_SEARCH_SHARDS: "true" })).toBe(false);
    expect(isWhitelistSearchSharded({ WHITELIST_SEARCH_SHARDS: "1" })).toBe(true);
    expect(getWhitelistSearchHopBudgetMs({})).toBe(DEFAULT_WHITELIST_SEARCH_HOP_BUDGET_MS);
    expect(getWhitelistSearchHopBudgetMs({ WHITELIST_SEARCH_HOP_BUDGET_MS: "480000" })).toBe(480_000);
    expect(() => getWhitelistSearchHopBudgetMs({ WHITELIST_SEARCH_HOP_BUDGET_MS: "1000" })).toThrow("integer");
    expect(() => getWhitelistSearchHopBudgetMs({ WHITELIST_SEARCH_HOP_BUDGET_MS: "900000" })).toThrow("integer");
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
    expect(getR2KeyPrefix()).toBe("");
    expect(getR2KeyPrefix({})).toBe("");
    expect(getR2KeyPrefix({ R2_PREFIX: "migrate-dev/" })).toBe("migrate-dev/");
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

  test("refuses R2 writes when DEPLOY_ENV is unset, including on Cloudflare", async () => {
    let reads = 0;
    const readIdentity = async () => {
      reads += 1;
      return null;
    };
    await expect(assertR2WritesAllowed({ HOSTING_TARGET: "cf" }, readIdentity, "gitstarclub-assets")).rejects.toThrow(
      "unset on Cloudflare",
    );
    await expect(assertR2WritesAllowed({}, readIdentity, "gitstarclub-assets")).rejects.toThrow("DEPLOY_ENV is unset");
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "local" }, readIdentity, "gitstarclub-assets")).rejects.toThrow(
      "DEPLOY_ENV=local",
    );
    expect(reads).toBe(0);
  });

  test("refuses R2 writes when the bucket identity does not match DEPLOY_ENV", async () => {
    const marker = JSON.stringify({ bucket: "gitstarclub-prod", deploy_env: "production" });
    await expect(
      assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => marker, "gitstarclub-prod"),
    ).rejects.toThrow("deploy_env=production does not match DEPLOY_ENV=pre");
  });

  test("refuses R2 writes when the bucket identity marker is missing or unreadable", async () => {
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => null, "gitstarclub-pre")).rejects.toThrow(
      "marker is missing",
    );
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => "   ", "gitstarclub-pre")).rejects.toThrow(
      "marker is missing",
    );
    await expect(
      assertR2WritesAllowed(
        { DEPLOY_ENV: "pre" },
        async () => {
          throw new Error("network down");
        },
        "gitstarclub-pre",
      ),
    ).rejects.toThrow("marker is unreadable");
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => "not-json", "gitstarclub-pre")).rejects.toThrow(
      "marker is unreadable",
    );
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => "{}", "gitstarclub-pre")).rejects.toThrow(
      "marker is unreadable",
    );
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, async () => "[]", "gitstarclub-pre")).rejects.toThrow(
      "marker is unreadable",
    );
    await expect(
      assertR2WritesAllowed(
        { DEPLOY_ENV: "pre" },
        async () => JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "local" }),
        "gitstarclub-pre",
      ),
    ).rejects.toThrow("marker is unreadable");
    await expect(
      assertR2WritesAllowed(
        { DEPLOY_ENV: "pre" },
        async () => JSON.stringify({ bucket: "other", deploy_env: "pre" }),
        "gitstarclub-pre",
      ),
    ).rejects.toThrow('bucket "other"');
  });

  test("caches a matching bucket identity for the isolate", async () => {
    let reads = 0;
    const readIdentity = async () => {
      reads += 1;
      return JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "pre" });
    };
    const env = { DEPLOY_ENV: "pre", R2_ACCOUNT_ID: "acct" };
    await expect(assertR2WritesAllowed(env, readIdentity, "gitstarclub-pre")).resolves.toBeUndefined();
    await expect(assertR2WritesAllowed(env, readIdentity, "gitstarclub-pre")).resolves.toBeUndefined();
    expect(reads).toBe(1);
    await expect(
      assertR2WritesAllowed(
        env,
        async () => JSON.stringify({ bucket: "gitstarclub-prod", deploy_env: "production" }),
        "gitstarclub-prod",
      ),
    ).rejects.toThrow("does not match DEPLOY_ENV=pre");
  });

  test("refuses an invalid DEPLOY_ENV or a blank bucket before reading the marker", async () => {
    let reads = 0;
    const readIdentity = async () => {
      reads += 1;
      return null;
    };
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "staging" }, readIdentity, "gitstarclub-pre")).rejects.toThrow(
      "refusing R2 writes",
    );
    await expect(assertR2WritesAllowed({ DEPLOY_ENV: "pre" }, readIdentity, "  ")).rejects.toThrow("bucket name is unset");
    expect(reads).toBe(0);
  });

  test("isProductionDeployment sees DEPLOY_ENV from the live Worker env", async () => {
    delete process.env.DEPLOY_ENV;
    mock.module("@opennextjs/cloudflare", () => ({
      getCloudflareContext: () => ({
        env: { DEPLOY_ENV: "production", JOBS: { send: async () => {} } },
      }),
    }));
    try {
      expect(isProductionDeployment()).toBe(true);
      expect(isProductionDeployment({})).toBe(false);
    } finally {
      mock.restore();
    }
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
    expect(DEFAULT_CF_PREVIEW_ORIGIN).toBe("https://gitstarclub-web-pre.worldgo.workers.dev");
    expect(DEFAULT_CF_PREVIEW_ORIGIN).not.toBe("https://gitstarclub-web.worldgo.workers.dev");
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

describe("P3 hosting target", () => {
  test("defaults hosting to Vercel and accepts cf only off production", () => {
    expect(getHostingTarget({})).toBe("vercel");
    expect(getHostingTarget({ HOSTING_TARGET: "cf" })).toBe("cf");
    expect(isCloudflareWorkersHost({ HOSTING_TARGET: "cf" })).toBe(true);
    expect(isCloudflareWorkersHost({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" })).toBe(false);
  });

  test("refuses HOSTING_TARGET=cf as the Vercel production source of truth", () => {
    expect(() => assertHostingTargetAllowed({ HOSTING_TARGET: "cf", VERCEL_ENV: "production" })).toThrow(
      "HOSTING_TARGET",
    );
    expect(() => assertHostingTargetAllowed({ VERCEL_ENV: "production" })).not.toThrow();
  });

  test("async-local override isolates host detection from process.env", async () => {
    const previous = process.env.HOSTING_TARGET;
    process.env.HOSTING_TARGET = "cf";
    try {
      expect(isCloudflareWorkersHost()).toBe(true);
      await runWithCloudflareWorkersHostForTests(false, async () => {
        expect(isCloudflareWorkersHost()).toBe(false);
        expect(isCloudflareWorkersHost({ HOSTING_TARGET: "cf" })).toBe(true);
      });
      await runWithCloudflareWorkersHostForTests(true, async () => {
        process.env.HOSTING_TARGET = "vercel";
        expect(isCloudflareWorkersHost()).toBe(true);
        expect(isCloudflareWorkersHost({ HOSTING_TARGET: "vercel" })).toBe(false);
      });
    } finally {
      if (previous === undefined) delete process.env.HOSTING_TARGET;
      else process.env.HOSTING_TARGET = previous;
    }
  });
});
