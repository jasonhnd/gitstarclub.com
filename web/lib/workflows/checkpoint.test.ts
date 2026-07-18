import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as alert from "@/lib/observability/alert";
import * as write from "@/lib/data/write";
import * as lease from "@/lib/workflows/lease";
import { markFailed, startRun } from "./checkpoint";

// startRun must write the manifest without re-claiming the workflow lease.
// The HTTP start route already holds ops/workflows/active.json for this runId;
// a second claim is what produced the July-18 production deadlocks.

describe("workflow checkpoints", () => {
  let putView: ReturnType<typeof spyOn>;
  let release: ReturnType<typeof spyOn>;
  let recordHealth: ReturnType<typeof spyOn>;
  let sendAlert: ReturnType<typeof spyOn>;
  let claim: ReturnType<typeof spyOn>;

  beforeEach(() => {
    putView = spyOn(write, "putView").mockResolvedValue(undefined as never);
    release = spyOn(lease, "releaseWorkflowLease").mockResolvedValue(true);
    claim = spyOn(lease, "claimWorkflowLease").mockImplementation(async () => {
      throw new Error("startRun must not re-claim the lease");
    });
    recordHealth = spyOn(alert, "recordHealth").mockResolvedValue(undefined);
    sendAlert = spyOn(alert, "sendAlert").mockResolvedValue(undefined);
  });

  afterEach(() => {
    putView.mockRestore();
    release.mockRestore();
    claim.mockRestore();
    recordHealth.mockRestore();
    sendAlert.mockRestore();
  });

  test("startRun writes a running manifest without claiming a lease", async () => {
    const startedAt = await startRun("refresh-test-1");
    expect(startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(claim).not.toHaveBeenCalled();
    expect(putView).toHaveBeenCalledTimes(1);
    const [path, body] = putView.mock.calls[0] as [string, { run_id: string; status: string; steps: string[] }];
    expect(path).toBe("ops/workflows/refresh-test-1/manifest.json");
    expect(body.run_id).toBe("refresh-test-1");
    expect(body.status).toBe("running");
    expect(body.steps).toContain("fold");
  });

  test("markFailed releases the route-held lease even when startRun never completed", async () => {
    await markFailed("refresh-test-2", "2026-07-18T00:00:00.000Z", "startRun blew up");

    expect(release).toHaveBeenCalledWith("refresh-test-2", "failed");
    expect(putView.mock.calls.map((c) => c[0])).toEqual([
      "ops/workflows/refresh-test-2/manifest.json",
      "ops/workflows/refresh-test-2/error.json",
    ]);
    expect(recordHealth).toHaveBeenCalledWith("workflow-refresh", "failed", {
      run_id: "refresh-test-2",
      error: "startRun blew up",
    });
  });
});
