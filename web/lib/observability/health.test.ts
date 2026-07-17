import { describe, expect, spyOn, test } from "bun:test";
import type {
  AlertPipeline,
  HealthStatus,
  PipelineHealth,
} from "@/lib/contracts";
import {
  healthPath,
  mergePipelineHealth,
  recordHealth,
  type HealthSnapshot,
  type HealthStore,
} from "./health";

class MemoryHealthStore implements HealthStore {
  private values = new Map<AlertPipeline, PipelineHealth>();
  private versions = new Map<AlertPipeline, number>();

  async read(pipeline: AlertPipeline): Promise<HealthSnapshot> {
    const health = this.values.get(pipeline);
    const version = this.versions.get(pipeline);
    return {
      health: health ? structuredClone(health) : null,
      etag: version === undefined ? null : `"${version}"`,
    };
  }

  async create(pipeline: AlertPipeline, health: PipelineHealth): Promise<boolean> {
    if (this.values.has(pipeline)) return false;
    this.values.set(pipeline, structuredClone(health));
    this.versions.set(pipeline, 1);
    return true;
  }

  async compareAndSet(
    pipeline: AlertPipeline,
    etag: string,
    health: PipelineHealth,
  ): Promise<boolean> {
    const version = this.versions.get(pipeline);
    if (version === undefined || etag !== `"${version}"`) return false;
    this.values.set(pipeline, structuredClone(health));
    this.versions.set(pipeline, version + 1);
    return true;
  }

  async value(pipeline: AlertPipeline): Promise<PipelineHealth | null> {
    return (await this.read(pipeline)).health;
  }
}

test("health paths are isolated by pipeline", () => {
  expect(healthPath("cron-daily")).toBe("ops/workflows/health/cron-daily.json");
  expect(healthPath("cron-weekly")).toBe("ops/workflows/health/cron-weekly.json");
  expect(healthPath("workflow-refresh")).toBe(
    "ops/workflows/health/workflow-refresh.json",
  );
});

describe("mergePipelineHealth", () => {
  test("preserves last failure when a later success clears the current failure state", () => {
    const failed = mergePipelineHealth(
      null,
      "cron-daily",
      "failed",
      { run_id: "daily-failed", error: "upstream 500" },
      new Date("2026-07-17T01:00:00.000Z"),
    );
    const recovered = mergePipelineHealth(
      failed,
      "cron-daily",
      "ok",
      { run_id: "daily-ok" },
      new Date("2026-07-17T02:00:00.000Z"),
    );

    expect(recovered.status).toBe("ok");
    expect(recovered.last_success?.run_id).toBe("daily-ok");
    expect(recovered.last_failure?.run_id).toBe("daily-failed");
    expect(recovered.last_failure?.error).toBe("upstream 500");
    expect(recovered.freshness).toEqual({
      last_success_at: "2026-07-17T02:00:00.000Z",
      expected_within_seconds: 129_600,
      stale_after: "2026-07-18T14:00:00.000Z",
    });
  });

  test("an older completion cannot replace a newer latest signal", () => {
    const latest = mergePipelineHealth(
      null,
      "cron-weekly",
      "ok",
      { run_id: "newer" },
      new Date("2026-07-17T03:00:00.000Z"),
    );
    const merged = mergePipelineHealth(
      latest,
      "cron-weekly",
      "failed",
      { run_id: "older", error: "late failure" },
      new Date("2026-07-17T02:00:00.000Z"),
    );

    expect(merged.status).toBe("ok");
    expect(merged.run_id).toBe("newer");
    expect(merged.last_failure?.run_id).toBe("older");
  });
});

describe("recordHealth", () => {
  test("concurrent updates preserve independent state for every pipeline", async () => {
    const store = new MemoryHealthStore();
    const updates: Array<{
      pipeline: AlertPipeline;
      status: HealthStatus;
      run_id: string;
      at: string;
    }> = [
      { pipeline: "cron-daily", status: "failed", run_id: "d-fail", at: "2026-07-17T01:00:00.000Z" },
      { pipeline: "cron-daily", status: "ok", run_id: "d-ok", at: "2026-07-17T02:00:00.000Z" },
      { pipeline: "cron-weekly", status: "failed", run_id: "w-fail", at: "2026-07-17T01:00:00.000Z" },
      { pipeline: "workflow-refresh", status: "ok", run_id: "r-ok", at: "2026-07-17T02:00:00.000Z" },
    ];

    await Promise.all(
      updates.map(({ pipeline, status, run_id, at }) =>
        recordHealth(
          pipeline,
          status,
          { run_id, error: status === "failed" ? `${run_id}-error` : undefined },
          { store, now: new Date(at) },
        ),
      ),
    );

    const daily = await store.value("cron-daily");
    const weekly = await store.value("cron-weekly");
    const workflow = await store.value("workflow-refresh");
    expect(daily?.status).toBe("ok");
    expect(daily?.last_success?.run_id).toBe("d-ok");
    expect(daily?.last_failure?.run_id).toBe("d-fail");
    expect(weekly?.status).toBe("failed");
    expect(weekly?.last_failure?.run_id).toBe("w-fail");
    expect(workflow?.status).toBe("ok");
    expect(workflow?.last_failure).toBeNull();
  });

  test("a store failure is diagnostic but never breaks the pipeline", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const store: HealthStore = {
      read: async () => {
        throw new Error("Blob unavailable");
      },
      create: async () => false,
      compareAndSet: async () => false,
    };
    try {
      await expect(
        recordHealth("cron-daily", "failed", {}, { store }),
      ).resolves.toBeUndefined();
      expect(String(errorSpy.mock.calls[0]?.[0])).toContain("health write failed");
    } finally {
      errorSpy.mockRestore();
    }
  });
});
