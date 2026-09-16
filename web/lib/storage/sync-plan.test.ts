import { describe, expect, test } from "bun:test";
import { assertBlobToR2SyncAllowed, describeBlobToR2SyncPlan } from "./sync-plan";

const nonProdR2 = {
  R2_PREFIX: "migrate-dev/",
  VERCEL_ENV: "preview",
};

describe("blob→R2 sync plan", () => {
  test("defaults to dry-run against migrate-dev/", () => {
    expect(describeBlobToR2SyncPlan({ env: nonProdR2 })).toEqual({
      execute: false,
      sourcePrefix: "",
      destinationPrefix: "migrate-dev/",
      readDriver: "blob",
    });
  });

  test("refuses production and production prefixes", () => {
    expect(() => assertBlobToR2SyncAllowed({ execute: true, env: { ...nonProdR2, VERCEL_ENV: "production" } })).toThrow(
      "VERCEL_ENV=production",
    );
    expect(() => assertBlobToR2SyncAllowed({ execute: false, env: { R2_PREFIX: "" } })).toThrow("non-production");
    expect(() => assertBlobToR2SyncAllowed({ execute: false, env: { R2_PREFIX: "canonical/" } })).toThrow(
      "non-production",
    );
  });
});
