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
const originalPublicBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
const originalReadDriver = process.env.STORAGE_READ_DRIVER;
const originalR2PublicBase = process.env.R2_PUBLIC_BASE_URL;
const originalWriteToken = process.env.BLOB_READ_WRITE_TOKEN;

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
  if (originalPublicBase === undefined) delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  else process.env.NEXT_PUBLIC_BLOB_BASE_URL = originalPublicBase;
  if (originalReadDriver === undefined) delete process.env.STORAGE_READ_DRIVER;
  else process.env.STORAGE_READ_DRIVER = originalReadDriver;
  if (originalR2PublicBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
  else process.env.R2_PUBLIC_BASE_URL = originalR2PublicBase;
  if (originalWriteToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalWriteToken;
});

function refreshResult(postCommitErrors: string[]) {
  return {
    job: "daily" as const,
    dry: false,
    day: "2026-06-21",
    month: "2026-06",
    week: "2026-W25",
    polled: 1,
    day_total: 0,
    writes: [],
    all_time_repo_1: null,
    current_week_flow_1: null,
    current_month_flow_1: null,
    generation: "gen",
    previous_generation: null,
    published_at: "2026-06-21T03:00:00.000Z",
    post_commit_errors: postCommitErrors,
  };
}

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

  test("reads ops/sync-runs.json from the R2 public base without Blob env", async () => {
    delete process.env.BLOB_BASE_URL;
    delete process.env.NEXT_PUBLIC_BLOB_BASE_URL;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    process.env.STORAGE_READ_DRIVER = "r2_binding";
    process.env.R2_PUBLIC_BASE_URL = "https://r2.example.com";
    let fetched = "";
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      fetched = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ generated_at: "old", runs: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const run = completedRun("daily-r2", "daily", true, new Date("2026-06-21T03:00:00.000Z"), {
      job: "daily",
      dry: true,
      day: "2026-06-21",
      month: "2026-06",
      week: "2026-W25",
      polled: 1,
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
    expect(fetched.startsWith("https://r2.example.com/ops/sync-runs.json")).toBe(true);
    expect(putCalls).toHaveLength(1);
  });

  test("stored sync-run JSON omits secret canaries and keeps the failure category", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    const cron = "CANARYCRONSECRET1234567890abcd";
    const previousCron = process.env.CRON_SECRET;
    process.env.CRON_SECRET = cron;
    try {
      const run = failedRun(
        "weekly-test",
        "weekly",
        false,
        new Date("2026-06-21T03:00:00.000Z"),
        new Error(`GitHub GraphQL 502 Bearer CANARYBEARERTOKEN1234567890abcd ${canary} ${cron}`),
      );
      await expect(safeRecordSyncRun(run)).resolves.toBeNull();
      const stored = JSON.stringify(putCalls);
      expect(stored).toContain("GitHub GraphQL 502");
      expect(stored).not.toContain("CANARY");
    } finally {
      if (previousCron === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCron;
    }
  });

  test("stored post_commit_errors and retained history omit secret canaries", async () => {
    const canary = "ghp_CANARYMISSEDSINK1234567890abcd";
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          generated_at: "old",
          runs: [
            {
              id: "daily-old",
              job: "daily",
              status: "ok",
              dry: false,
              started_at: "2026-06-20T03:00:00.000Z",
              finished_at: "2026-06-20T03:00:01.000Z",
              duration_ms: 1000,
              result: refreshResult([`indexnow: GitHub GraphQL 502 ${canary}`]),
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const run = completedRun(
      "daily-new",
      "daily",
      false,
      new Date("2026-06-21T03:00:00.000Z"),
      refreshResult([`revalidate: GitHub GraphQL 502 ${canary}`]),
    );
    await expect(safeRecordSyncRun(run)).resolves.toBeNull();
    const stored = JSON.stringify(putCalls);
    expect(stored).toContain("revalidate: GitHub GraphQL 502");
    expect(stored).toContain("indexnow: GitHub GraphQL 502");
    expect(stored).not.toContain("CANARY");
  });

  test("sync-run write failures returned to the caller omit secret canaries", async () => {
    const canary = "ghp_CANARYGITHUBTOKEN1234567890abcd";
    putImpl = async () => {
      throw new Error(`blob write failed ${canary}`);
    };
    const run = failedRun("weekly-test", "weekly", false, new Date("2026-06-21T03:00:00.000Z"), new Error("boom"));
    const logged = await safeRecordSyncRun(run);
    expect(logged).toContain("blob write failed");
    expect(logged).not.toContain("CANARY");
  });
});
