import { describe, expect, test } from "bun:test";
import { assertBlobDeletionAllowed } from "@/lib/blob-deletion";
import {
  assertDeleteConfirmation,
  BLOB_DEL_PREFIX_USAGE,
  deletionContextFromPointers,
  interpretBlobDelPrefixArgs,
} from "../../scripts/lib/blob-del-prefix";

const token = { BLOB_READ_WRITE_TOKEN: "test-token" };
const now = Date.parse("2026-10-01T00:00:00.000Z");

describe("blob-del-prefix arguments", () => {
  test("help wins before a missing token or a bad store flag", () => {
    expect(interpretBlobDelPrefixArgs(["--help"], {})).toEqual({ action: "help" });
    expect(interpretBlobDelPrefixArgs(["-h"], {})).toEqual({ action: "help" });
    expect(interpretBlobDelPrefixArgs(["--store", "nope", "--help"], {})).toEqual({ action: "help" });
  });

  test("a Blob store without a token is refused before the prefix check", () => {
    expect(interpretBlobDelPrefixArgs(["views/verify-123/"], {})).toEqual({
      action: "error",
      message: "BLOB_READ_WRITE_TOKEN not set",
    });
    expect(interpretBlobDelPrefixArgs([], token)).toEqual({
      action: "error",
      message: BLOB_DEL_PREFIX_USAGE,
    });
  });

  test("dry-run stays off execute, and confirm must match the prefix exactly", () => {
    const preview = interpretBlobDelPrefixArgs(["views/verify-123/", "--execute", "--dry"], token);
    expect(preview).toMatchObject({ action: "run", prefix: "views/verify-123/", execute: false });
    const dryRun = interpretBlobDelPrefixArgs(["--dry-run", "views/verify-123/", "--execute"], token);
    expect(dryRun).toMatchObject({ action: "run", execute: false });
    const execute = interpretBlobDelPrefixArgs(
      ["--execute", "--confirm", "views/verify-123/", "views/verify-123/"],
      token,
    );
    expect(execute).toMatchObject({
      action: "run",
      execute: true,
      confirmation: "views/verify-123/",
      prefix: "views/verify-123/",
    });
    expect(() => assertDeleteConfirmation("views/other/", "views/verify-123/")).toThrow(
      '--confirm must exactly equal "views/verify-123/"',
    );
    expect(() => assertDeleteConfirmation(undefined, "views/verify-123/")).toThrow(
      '--confirm must exactly equal "views/verify-123/"',
    );
    expect(() => assertDeleteConfirmation("views/verify-123/", "views/verify-123/")).not.toThrow();
  });

  test("R2 still requires a target, and a missing confirm value is rejected", () => {
    const decision = interpretBlobDelPrefixArgs(
      ["--store", "r2", "--target", "pre", "views/verify-123/"],
      {},
    );
    expect(decision).toMatchObject({
      action: "run",
      prefix: "views/verify-123/",
      execute: false,
      selection: { store: "r2", target: "pre" },
    });
    expect(() => interpretBlobDelPrefixArgs(["--target", "pre", "views/verify-123/"], token)).toThrow(
      "--target requires --store r2",
    );
    expect(() => interpretBlobDelPrefixArgs(["views/verify-123/", "--confirm"], token)).toThrow(
      "--confirm requires a value",
    );
  });
});

describe("blob-del-prefix protection", () => {
  test("refuses _meta, pointers, and the current or rollback generation", () => {
    const context = deletionContextFromPointers(
      { version: "refresh-current", prev_version: "refresh-previous" },
      { generation: "bootstrap-current", previous_generation: "bootstrap-previous" },
      { status: "running", expires_at: "2026-10-02T00:00:00.000Z", run_id: "refresh-active" },
      now,
    );
    expect(context).toMatchObject({
      currentViewVersion: "refresh-current",
      rollbackViewVersion: "refresh-previous",
      activeWorkflowRun: "refresh-active",
      currentBootstrapGeneration: "bootstrap-current",
      rollbackBootstrapGeneration: "bootstrap-previous",
    });
    for (const prefix of [
      "_meta/",
      "_meta/bucket-identity/",
      "views/latest.json/",
      "bootstrap/latest.json/",
      "views/refresh-current/",
      "views/refresh-previous/",
      "views/refresh-active/",
      "bootstrap/generations/bootstrap-current/",
      "bootstrap/overlays/bootstrap-current/",
      "bootstrap/generations/bootstrap-previous/",
      "bootstrap/overlays/bootstrap-previous/",
    ]) {
      expect(() => assertBlobDeletionAllowed(prefix, context)).toThrow(/refusing/);
    }
    expect(assertBlobDeletionAllowed("views/verify-123/", context)).toBe("views/verify-123/");
  });

  test("an expired or idle lease does not protect that run id", () => {
    expect(
      deletionContextFromPointers(
        { version: "v1", prev_version: null },
        { generation: null, previous_generation: null },
        { status: "running", expires_at: "2020-01-01T00:00:00.000Z", run_id: "old" },
        now,
      ).activeWorkflowRun,
    ).toBeNull();
    expect(
      deletionContextFromPointers(
        null,
        null,
        { status: "published", expires_at: "2026-10-02T00:00:00.000Z", run_id: "done" },
        now,
      ).activeWorkflowRun,
    ).toBeNull();
    expect(
      deletionContextFromPointers(
        null,
        null,
        { status: "running", expires_at: "not-a-date", run_id: "bad" },
        now,
      ).activeWorkflowRun,
    ).toBeNull();
  });
});
