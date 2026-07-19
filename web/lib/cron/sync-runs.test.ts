import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let putImpl: (path: string, data: unknown) => Promise<void> = async () => {};
let putCalls: Array<{ path: string; data: unknown }> = [];

mock.module("@/lib/data/write", () => ({
  putView: (path: string, data: unknown) => putImpl(path, data),
  createView: async () => true,
}));

const { completedRun, failedRun, safeRecordSyncRun, syncRunId } = await import("./sync-runs");

const originalFetch = globalThis.fetch;
const originalBase = process.env.BLOB_BASE_URL;

beforeEach(() => {
  putCalls = [];
  putImpl = async (path, data) => {
    putCalls.push({ path, data });
  };
  process.env.BLOB_BASE_URL = "https://blob.example.com";
  globalThis.fetch = mock(async () => new Response(JSON.stringify({ generated_at: "old", runs: [] }), { status: 200 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBase === undefined) delete process.env.BLOB_BASE_URL;
  else process.env.BLOB_BASE_URL = originalBase;
});

describe("sync run helpers", () => {
  test("syncRunId is stable and filesystem-safe", () => {
    expect(syncRunId("daily", new Date("2026-06-21T03:04:05.678Z"))).toBe("daily-2026-06-21T03-04-05-678Z");
  });

  test("safeRecordSyncRun appends the run and writes ops/sync-runs.json", async () => {
    const run = completedRun("daily-test", "daily", true, new Date("2026-06-21T03:00:00.000Z"), {
      job: "daily",
      dry: true,
      day: "2026-06-21",
      month: "2026-06",
      week: "2026-W25",
      polled: 2,
      day_total: 0,
      writes: [],
      all_time_repo_1: null,
      current_week_flow_1: null,
      current_month_flow_1: null,
      generation: null,
      previous_generation: null,
      published_at: null,
      post_commit_errors: [],
    });

    await expect(safeRecordSyncRun(run)).resolves.toBeNull();

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].path).toBe("ops/sync-runs.json");
    const data = putCalls[0].data as { runs: Array<{ id: string; status: string; dry: boolean }> };
    expect(data.runs[0]).toMatchObject({ id: "daily-test", status: "ok", dry: true });
  });

  test("safeRecordSyncRun reports write failures instead of throwing", async () => {
    putImpl = async () => {
      throw new Error("blob write failed");
    };
    const run = failedRun("weekly-test", "weekly", false, new Date("2026-06-21T03:00:00.000Z"), new Error("boom"));

    await expect(safeRecordSyncRun(run)).resolves.toBe("blob write failed");
  });
});
