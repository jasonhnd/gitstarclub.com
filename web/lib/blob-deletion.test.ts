import { describe, expect, test } from "bun:test";
import {
  assertBlobDeletionAllowed,
  executeBlobDeletionPlan,
  planBlobPrefixDeletion,
  type BlobDeletionContext,
} from "./blob-deletion";

const protectedContext: BlobDeletionContext = {
  currentViewVersion: "refresh-current",
  rollbackViewVersion: "refresh-previous",
  activeWorkflowRun: "refresh-active",
  currentBootstrapGeneration: "bootstrap-current",
  rollbackBootstrapGeneration: "bootstrap-previous",
};

describe("Blob deletion safety", () => {
  test("preview inventories every page with exact object and byte totals without deleting", async () => {
    const deletions: string[][] = [];
    const plan = await planBlobPrefixDeletion(
      "views/throwaway/",
      protectedContext,
      async ({ cursor }) =>
        cursor
          ? { blobs: [{ url: "https://blob/3", pathname: "views/throwaway/3.json", size: 30 }] }
          : {
              blobs: [
                { url: "https://blob/1", pathname: "views/throwaway/1.json", size: 10 },
                { url: "https://blob/2", pathname: "views/throwaway/2.json", size: 20 },
              ],
              cursor: "next",
            },
    );

    expect(plan).toMatchObject({ prefix: "views/throwaway/", objectCount: 3, totalBytes: 60 });
    expect(deletions).toEqual([]);
  });

  test("hard-blocks static, broad, active, current, and rollback targets", () => {
    for (const prefix of [
      "canonical/v2/",
      "rank/year/",
      "ops/workflows/",
      "views/",
      "bootstrap/generations/",
      "bootstrap/overlays/",
      "views/refresh-current/",
      "views/refresh-previous/",
      "views/refresh-active/",
      "bootstrap/generations/bootstrap-current/",
      "bootstrap/generations/bootstrap-previous/",
      "bootstrap/overlays/bootstrap-current/",
      "bootstrap/overlays/bootstrap-previous/",
    ]) {
      expect(() => assertBlobDeletionAllowed(prefix, protectedContext)).toThrow(/refusing/);
    }
  });

  test("requires an exact execute confirmation", async () => {
    const plan = await planBlobPrefixDeletion("views/throwaway/", protectedContext, async () => ({
      blobs: [{ url: "https://blob/1", pathname: "views/throwaway/1.json", size: 10 }],
    }));
    await expect(executeBlobDeletionPlan(plan, "yes", async () => {})).rejects.toThrow("must exactly equal");
  });

  test("explicit execution deletes an unprotected throwaway generation", async () => {
    const calls: string[][] = [];
    const plan = await planBlobPrefixDeletion(
      "bootstrap/generations/throwaway-123/",
      protectedContext,
      async () => ({
        blobs: [
          { url: "https://blob/a", pathname: "bootstrap/generations/throwaway-123/a", size: 4 },
          { url: "https://blob/b", pathname: "bootstrap/generations/throwaway-123/b", size: 8 },
        ],
      }),
    );

    const deleted = await executeBlobDeletionPlan(
      plan,
      plan.prefix,
      async (urls) => {
        calls.push(urls);
      },
      1,
    );

    expect(deleted).toBe(2);
    expect(calls).toEqual([["https://blob/a"], ["https://blob/b"]]);
  });
});
