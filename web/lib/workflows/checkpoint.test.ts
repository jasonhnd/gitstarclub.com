import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as alert from "@/lib/observability/alert";
import * as health from "@/lib/observability/health";
import * as lease from "@/lib/workflows/lease";
import * as owned from "@/lib/workflows/owned-write";
import { markFailed, startRun } from "./checkpoint";

// On the pre fencing line, startRun re-validates ownership via claimWorkflowLease
// (allowExistingRun) and writes through putOwnedView (renew-before-write).

describe("workflow checkpoints (fenced)", () => {
  let putOwned: ReturnType<typeof spyOn>;
  let release: ReturnType<typeof spyOn>;
  let recordHealth: ReturnType<typeof spyOn>;
  let sendAlert: ReturnType<typeof spyOn>;
  let claim: ReturnType<typeof spyOn>;

  beforeEach(() => {
    putOwned = spyOn(owned, "putOwnedView").mockResolvedValue(undefined as never);
    release = spyOn(lease, "releaseWorkflowLease").mockResolvedValue(true);
    claim = spyOn(lease, "claimWorkflowLease").mockResolvedValue({
      status: "acquired",
      lease: {
        run_id: "refresh-test-1",
        status: "running",
        acquired_at: "2026-07-18T00:00:00.000Z",
        expires_at: "2026-07-18T00:30:00.000Z",
        fencing_token: 3,
        idempotency_key: "run:refresh-test-1",
        trigger: "workflow",
      },
    } as never);
    recordHealth = spyOn(health, "recordHealth").mockResolvedValue(undefined as never);
    sendAlert = spyOn(alert, "sendAlert").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    putOwned.mockRestore();
    release.mockRestore();
    claim.mockRestore();
    recordHealth.mockRestore();
    sendAlert.mockRestore();
  });

  test("startRun claims allowExistingRun and returns fencing token", async () => {
    const result = await startRun("refresh-test-1");
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.fencingToken).toBe(3);
    expect(claim).toHaveBeenCalled();
    const claimArgs = claim.mock.calls[0][0] as { runId: string; allowExistingRun?: boolean };
    expect(claimArgs.runId).toBe("refresh-test-1");
    expect(claimArgs.allowExistingRun).toBe(true);
    expect(putOwned).toHaveBeenCalled();
  });

  test("startRun rejects when another run owns the lease", async () => {
    claim.mockResolvedValueOnce({
      status: "rejected",
      lease: {
        run_id: "refresh-other",
        status: "running",
        acquired_at: "2026-07-18T00:00:00.000Z",
        expires_at: "2026-07-18T00:30:00.000Z",
        fencing_token: 9,
        idempotency_key: "other",
        trigger: "cron",
      },
    } as never);
    await expect(startRun("refresh-test-1")).rejects.toThrow(/already running/);
  });

  test("markFailed releases with fencing token", async () => {
    await markFailed("refresh-test-2", "2026-07-18T00:00:00.000Z", "boom", 4);
    expect(release).toHaveBeenCalledWith("refresh-test-2", "failed", undefined, undefined, 4);
    expect(putOwned.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(recordHealth).toHaveBeenCalledWith("workflow-refresh", "failed", {
      run_id: "refresh-test-2",
      error: "boom",
    });
  });
});
