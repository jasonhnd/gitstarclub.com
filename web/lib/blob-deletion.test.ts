import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import {
  claimWorkflowLease,
  releaseWorkflowLease,
  renewWorkflowLease,
  type WorkflowLeaseSnapshot,
  type WorkflowLeaseStore,
} from "@/lib/workflows/lease";
import {
  assertBlobDeletionAllowed,
  executeBlobDeletionPlan,
  planBlobPrefixDeletion,
  type BlobDeletionContext,
} from "./blob-deletion";

class MemoryLeaseStore implements WorkflowLeaseStore {
  lease: WorkflowLease | null = null;
  etag: string | null = null;
  private version = 0;

  async read(): Promise<WorkflowLeaseSnapshot> {
    return {
      lease: this.lease ? structuredClone(this.lease) : null,
      etag: this.etag,
    };
  }

  async create(lease: WorkflowLease): Promise<boolean> {
    if (this.lease) return false;
    this.lease = structuredClone(lease);
    this.etag = `etag-${++this.version}`;
    return true;
  }

  async compareAndSet(etag: string, lease: WorkflowLease): Promise<boolean> {
    if (this.etag !== etag) return false;
    this.lease = structuredClone(lease);
    this.etag = `etag-${++this.version}`;
    return true;
  }
}

const protectedContext: BlobDeletionContext = {
  currentViewVersion: "refresh-current",
  rollbackViewVersion: "refresh-previous",
  activeWorkflowRun: "refresh-active",
  currentBootstrapGeneration: "bootstrap-current",
  rollbackBootstrapGeneration: "bootstrap-previous",
};

const noopGuard = {
  ensureOwnership: async () => {},
  readContext: async () => protectedContext,
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
    await expect(executeBlobDeletionPlan(plan, "yes", noopGuard, async () => {})).rejects.toThrow("must exactly equal");
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
      noopGuard,
      async (urls) => {
        calls.push(urls);
      },
      1,
    );

    expect(deleted).toBe(2);
    expect(calls).toEqual([["https://blob/a"], ["https://blob/b"]]);
  });

  test("shared lease prevents publish or rollback from entering between protection recheck and delete", async () => {
    const store = new MemoryLeaseStore();
    const acquiredAt = "2026-07-17T06:00:00.000Z";
    const deletion = await claimWorkflowLease(
      {
        runId: "blob-delete-race-target",
        acquiredAt,
        idempotencyKey: "blob-delete:views/race-target/",
        trigger: "blob-delete-cli",
        now: Date.parse(acquiredAt),
      },
      store,
    );
    expect(deletion.status).toBe("acquired");
    if (deletion.status !== "acquired") throw new Error("test deletion lease was not acquired");

    const context: BlobDeletionContext = {};
    const plan = await planBlobPrefixDeletion("views/race-target/", context, async () => ({
      blobs: [{ url: "https://blob/race", pathname: "views/race-target/data.json", size: 7 }],
    }));
    const competitorStatuses: string[] = [];
    const deleted: string[] = [];
    const guard = {
      ensureOwnership: () =>
        renewWorkflowLease(
          deletion.lease.run_id,
          deletion.lease.fencing_token,
          store,
          "2026-07-17T06:01:00.000Z",
        ).then(() => undefined),
      readContext: async () => ({ ...context }),
    };

    await executeBlobDeletionPlan(plan, plan.prefix, guard, async (urls) => {
      // This callback starts after the guard's fresh protection read and final
      // fencing renewal, at the exact point the destructive Blob call begins.
      for (const operation of ["publish", "rollback"] as const) {
        const competitor = await claimWorkflowLease(
          {
            runId: `${operation}-race-target`,
            acquiredAt: "2026-07-17T06:02:00.000Z",
            idempotencyKey: `${operation}:race-target`,
            trigger: "test",
            now: Date.parse("2026-07-17T06:02:00.000Z"),
          },
          store,
        );
        competitorStatuses.push(competitor.status);
        if (competitor.status === "acquired") {
          // An unsafe implementation would let this pointer mutation make the
          // target current after the check but before deletion.
          if (operation === "publish") context.currentViewVersion = "race-target";
          else context.rollbackViewVersion = "race-target";
        }
      }
      deleted.push(...urls);
    });

    expect(competitorStatuses).toEqual(["rejected", "rejected"]);
    expect(context.currentViewVersion).toBeUndefined();
    expect(context.rollbackViewVersion).toBeUndefined();
    expect(deleted).toEqual(["https://blob/race"]);
    expect(
      await releaseWorkflowLease(
        deletion.lease.run_id,
        "published",
        store,
        "2026-07-17T06:03:00.000Z",
        deletion.lease.fencing_token,
      ),
    ).toBe(true);
  });
});
