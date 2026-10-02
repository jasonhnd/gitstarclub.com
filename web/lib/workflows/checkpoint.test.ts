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

  test("markFailed redacts punctuation and JSON-escaped assignments", async () => {
    await markFailed(
      "refresh-test-2",
      "2026-07-18T00:00:00.000Z",
      [
        "GitHub GraphQL 502",
        "password=!CANARYpunctuation42",
        "token=CANARYstart:CANARYtail!",
        String.raw`password=\"!CANARYescaped42\"`,
      ].join(" "),
      4,
    );
    const stored = JSON.stringify(putOwned.mock.calls);
    const alerted = JSON.stringify(sendAlert.mock.calls);
    const health = JSON.stringify(recordHealth.mock.calls);
    for (const text of [stored, alerted, health]) {
      expect(text).toContain("GitHub GraphQL 502");
      expect(text).not.toContain("CANARY");
    }
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

  function storedAt(suffix: string): Record<string, unknown> {
    const call = putOwned.mock.calls.find((args: unknown[]) => String(args[1]).endsWith(suffix));
    if (!call) throw new Error(`no putOwnedView call for ${suffix}`);
    return call[2] as Record<string, unknown>;
  }

  test("markFailed before the pointer commit keeps published_version null", async () => {
    await markFailed("refresh-test-2", "2026-07-18T00:00:00.000Z", "validate failed", 4);

    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    const failure = storedAt("/error.json");
    expect(failure).toMatchObject({ run_id: "refresh-test-2", error: "validate failed", phase: "pre_commit" });
    expect(failure).not.toHaveProperty("committed_version");
    expect(failure).not.toHaveProperty("failed_step");
    expect(sendAlert).toHaveBeenCalledWith({
      pipeline: "workflow-refresh",
      title: "managed refresh failed",
      run_id: "refresh-test-2",
      error: "validate failed",
    });
  });

  test("markFailed after the pointer commit records the live version and failed step", async () => {
    const message = "version refresh-test-3 is live; post-commit invalidate failed: -> 503";
    await markFailed("refresh-test-3", "2026-07-18T00:00:00.000Z", message, 4, {
      phase: "post_commit",
      version: "refresh-test-3",
      step: "invalidate",
    });

    expect(storedAt("/manifest.json")).toMatchObject({
      run_id: "refresh-test-3",
      status: "failed",
      published_version: "refresh-test-3",
    });
    expect(storedAt("/error.json")).toMatchObject({
      run_id: "refresh-test-3",
      error: message,
      phase: "post_commit",
      committed_version: "refresh-test-3",
      failed_step: "invalidate",
    });
    expect(release).toHaveBeenCalledWith("refresh-test-3", "failed", undefined, undefined, 4);
    expect(sendAlert).toHaveBeenCalledWith({
      pipeline: "workflow-refresh",
      title: "managed refresh published; post-commit step failed",
      run_id: "refresh-test-3",
      step: "invalidate",
      error: message,
    });
  });

  test("markFailed with an unknown commit state names the candidate version but publishes nothing", async () => {
    const message = "version refresh-test-4 may be live; pointer failed and the live pointer could not be read: 503";
    await markFailed("refresh-test-4", "2026-07-18T00:00:00.000Z", message, 4, {
      phase: "commit_unknown",
      version: "refresh-test-4",
      step: "pointer",
    });

    expect(storedAt("/manifest.json")).toMatchObject({ status: "failed", published_version: null });
    const failure = storedAt("/error.json");
    expect(failure).toMatchObject({
      phase: "commit_unknown",
      candidate_version: "refresh-test-4",
      failed_step: "pointer",
    });
    expect(failure).not.toHaveProperty("committed_version");
    expect(sendAlert).toHaveBeenCalledWith({
      pipeline: "workflow-refresh",
      title: "managed refresh failed; publication commit state unknown",
      run_id: "refresh-test-4",
      step: "pointer",
      error: message,
    });
  });

  test("markFailed stores and forwards a sanitized error", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    const cron = "CANARYCRONSECRET1234567890abcd";
    const previousCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = cron;
    try {
      await markFailed(
        "refresh-test-2",
        "2026-07-18T00:00:00.000Z",
        `GitHub GraphQL 502 Bearer CANARYBEARERTOKEN1234567890abcd ${canary} ${cron}`,
        4,
      );
      const stored = JSON.stringify(putOwned.mock.calls);
      const alerted = JSON.stringify(sendAlert.mock.calls);
      const health = JSON.stringify(recordHealth.mock.calls);
      for (const text of [stored, alerted, health]) {
        expect(text).toContain("GitHub GraphQL 502");
        expect(text).not.toContain("CANARY");
      }
    } finally {
      if (previousCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCron;
    }
  });
});
