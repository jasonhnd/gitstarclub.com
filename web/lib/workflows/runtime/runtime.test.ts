import { describe, expect, test } from "bun:test";
import { WorkflowLease } from "@/lib/contracts";
import { MemoryObjectStore } from "@/lib/storage";
import { BlobWorkflowLeaseStore, claimWorkflowLease } from "@/lib/workflows/lease";
import { CfQueueWorkflowRuntime } from "./cf-queue";
import { createFixtureDeps, executeFixtureStep } from "./fixture";
import { MemoryWorkflowRuntime } from "./memory";
import { firstRefreshJob } from "./types";

describe("memory workflow runtime", () => {
  test("drains a shrink fixture through lease CAS and view writes without the Workflow SDK", async () => {
    const objects = new MemoryObjectStore();
    const deps = createFixtureDeps(objects);
    const runtime = new MemoryWorkflowRuntime();

    await runtime.startRefresh("refresh-fixture-1", "fixture");
    const results = await runtime.drain((job) => {
      if (job.graph !== "fixture") throw new Error("expected fixture graph");
      return executeFixtureStep(job, deps);
    });

    expect(results.map((result) => result.name)).toEqual(["startRun", "writeViews", "complete"]);
    expect(runtime.queue).toEqual([]);

    const lease = await deps.leaseStore.read();
    expect(lease.lease?.run_id).toBe("refresh-fixture-1");
    expect(lease.lease?.status).toBe("published");
    expect(lease.etag).toBeTruthy();

    const manifest = JSON.parse((await objects.get("ops/workflows/refresh-fixture-1/manifest.json"))?.body ?? "null");
    expect(manifest).toMatchObject({ run_id: "refresh-fixture-1", status: "published", published_version: "refresh-fixture-1" });
    const view = JSON.parse((await objects.get("views/refresh-fixture-1/meta.json"))?.body ?? "null");
    expect(view).toMatchObject({ run_id: "refresh-fixture-1", schema_ver: 1 });
  });

  test("a second fixture run is rejected while the first lease is still running", async () => {
    const objects = new MemoryObjectStore();
    const leaseStore = new BlobWorkflowLeaseStore(undefined, objects);
    const acquiredAt = "2026-09-16T06:00:00.000Z";
    const first = await claimWorkflowLease(
      {
        runId: "refresh-holder",
        acquiredAt,
        idempotencyKey: "other-key",
        trigger: "test",
        now: Date.parse(acquiredAt),
      },
      leaseStore,
    );
    expect(first.status).toBe("acquired");

    const deps = { objects, leaseStore, now: () => new Date("2026-09-16T06:01:00.000Z") };
    const runtime = new MemoryWorkflowRuntime();
    await runtime.startRefresh("refresh-challenger", "fixture");
    await expect(
      runtime.drain((job) => {
        if (job.graph !== "fixture") throw new Error("expected fixture graph");
        return executeFixtureStep(job, deps);
      }, { retries: 0, delaysMs: [] }),
    ).rejects.toThrow(/already running/);
    expect((await leaseStore.read()).lease?.run_id).toBe("refresh-holder");
    expect((await leaseStore.read()).lease?.status).toBe("running");
  });

  test("retries a fixture step and still publishes through the same lease generation", async () => {
    const objects = new MemoryObjectStore();
    const deps = createFixtureDeps(objects);
    const runtime = new MemoryWorkflowRuntime();
    let writeAttempts = 0;

    await runtime.startRefresh("refresh-retry", "fixture");
    await runtime.drain(async (job) => {
      if (job.graph !== "fixture") throw new Error("expected fixture graph");
      if (job.name === "writeViews") {
        writeAttempts += 1;
        if (writeAttempts === 1) throw new Error("transient view write");
      }
      return executeFixtureStep(job, deps);
    }, { retries: 2, delaysMs: [0, 0] });

    expect(writeAttempts).toBe(2);
    expect((await deps.leaseStore.read()).lease?.status).toBe("published");
    expect((await objects.get("views/refresh-retry/meta.json"))?.body).toContain("refresh-retry");
  });
});

describe("CF Queue runtime adapter", () => {
  test("startRefresh and completeStep send one job at a time", async () => {
    const sent: string[] = [];
    const runtime = new CfQueueWorkflowRuntime(async (job) => {
      sent.push(job.name);
    });

    await runtime.startRefresh("refresh-cf", "fixture");
    expect(sent).toEqual(["startRun"]);

    await runtime.completeStep(firstRefreshJob("refresh-cf", "fixture"), {
      name: "startRun",
      startedAt: "2026-09-16T00:00:00.000Z",
      fencingToken: 1,
    });
    expect(sent).toEqual(["startRun", "writeViews"]);
  });
});

describe("lease contract still parses after fixture publish", () => {
  test("published lease remains a WorkflowLease", async () => {
    const objects = new MemoryObjectStore();
    const deps = createFixtureDeps(objects);
    const runtime = new MemoryWorkflowRuntime();
    await runtime.startRefresh("refresh-parse", "fixture");
    await runtime.drain((job) => {
      if (job.graph !== "fixture") throw new Error("expected fixture graph");
      return executeFixtureStep(job, deps);
    });
    const snapshot = await deps.leaseStore.read();
    expect(WorkflowLease.parse(snapshot.lease)).toMatchObject({ run_id: "refresh-parse", status: "published" });
  });
});
