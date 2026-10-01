import { describe, expect, test } from "bun:test";
import { missingBlobTokenOutcome, parseSyncBlobToR2Args } from "../../scripts/lib/sync-blob-to-r2-cli";

describe("sync-blob-to-r2 arguments", () => {
  test("defaults to a dry-run of the store root", () => {
    expect(parseSyncBlobToR2Args([])).toEqual({ execute: false, sourcePrefix: "" });
    expect(parseSyncBlobToR2Args(["--prefix=views/"])).toEqual({ execute: false, sourcePrefix: "" });
  });

  test("reads --prefix as the following argument and honors --execute", () => {
    expect(parseSyncBlobToR2Args(["--prefix", "views/", "--execute"])).toEqual({
      execute: true,
      sourcePrefix: "views/",
    });
    expect(parseSyncBlobToR2Args(["--execute", "--prefix"])).toEqual({ execute: true, sourcePrefix: "" });
    expect(parseSyncBlobToR2Args(["--prefix", "--execute"])).toEqual({
      execute: true,
      sourcePrefix: "--execute",
    });
  });

  test("a missing token skips the dry-run and blocks execute", () => {
    expect(missingBlobTokenOutcome(false)).toEqual({
      log: "dry-run listing skipped: BLOB_READ_WRITE_TOKEN is not set.",
      error: null,
    });
    expect(missingBlobTokenOutcome(true).error).toBe("BLOB_READ_WRITE_TOKEN is required for --execute");
  });
});
