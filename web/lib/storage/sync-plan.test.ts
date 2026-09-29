import { describe, expect, test } from "bun:test";
import { assertBlobToR2SyncAllowed, describeBlobToR2SyncPlan } from "./sync-plan";

const preEnv = {
  DEPLOY_ENV: "pre",
};

describe("blob→R2 sync plan", () => {
  test("defaults to a dry-run with an empty destination prefix", () => {
    expect(describeBlobToR2SyncPlan({ env: preEnv })).toEqual({
      execute: false,
      sourcePrefix: "",
      destinationPrefix: "",
      readDriver: "blob",
    });
  });

  test("keeps an explicit destination prefix", () => {
    expect(describeBlobToR2SyncPlan({ env: { ...preEnv, R2_PREFIX: "archive/" } }).destinationPrefix).toBe("archive/");
  });

  test("refuses a plan when DEPLOY_ENV is unset or cannot name a bucket", () => {
    expect(() => assertBlobToR2SyncAllowed({ execute: true, env: { HOSTING_TARGET: "cf" } })).toThrow(
      "unset on Cloudflare",
    );
    expect(() => assertBlobToR2SyncAllowed({ execute: false, env: {} })).toThrow("DEPLOY_ENV is unset");
    expect(() => assertBlobToR2SyncAllowed({ execute: false, env: { DEPLOY_ENV: "local" } })).toThrow("DEPLOY_ENV=local");
    expect(() => assertBlobToR2SyncAllowed({ execute: false, env: preEnv })).not.toThrow();
  });
});
