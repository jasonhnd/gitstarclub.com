import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { AlertSummary } from "@/lib/observability/alert";
import type { AlertPipeline, HealthStatus } from "@/lib/contracts";
import type { LiveRefreshResult } from "./live-refresh";
import { runLiveRefreshRoute, type LiveRefreshRouteOptions } from "./handlers";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

function request(job: "daily" | "weekly", query = ""): Request {
  return new Request(`https://gitstarclub.com/api/cron/${job}${query}`, {
    headers: { authorization: "Bearer test-secret" },
  });
}

function successfulRefresh(job: "daily" | "weekly", dry: boolean): Promise<LiveRefreshResult> {
  return Promise.resolve({
    job,
    dry,
    day: "2026-07-17",
    month: "2026-07",
    week: "2026-W29",
    polled: 2,
    day_total: 1,
    writes: ["current_month.json"],
    all_time_repo_1: null,
    current_week_flow_1: null,
    current_month_flow_1: null,
    generation: dry ? null : "test-generation",
    previous_generation: null,
    published_at: dry ? null : "2026-07-17T03:00:00.000Z",
    post_commit_errors: [],
  });
}

const claimPublication: NonNullable<LiveRefreshRouteOptions["claimPublication"]> = async (args) => ({
  status: "acquired",
  lease: {
    run_id: args.runId,
    idempotency_key: args.idempotencyKey,
    job: args.job,
    acquired_at: args.acquiredAt,
    expires_at: "2026-07-17T03:15:00.000Z",
  },
  previous_generation: null,
  etag: "test-etag",
});

const releasePublication: NonNullable<LiveRefreshRouteOptions["releasePublication"]> =
  async () => true;

describe("runLiveRefreshRoute health", () => {
  for (const job of ["daily", "weekly"] as const) {
    test(`records ${job} success with a run correlation ID`, async () => {
      const health: Array<{
        pipeline: AlertPipeline;
        status: HealthStatus;
        run_id?: string;
      }> = [];

      const response = await runLiveRefreshRoute(request(job), job, {
        now: new Date("2026-07-17T03:00:00.000Z"),
        requireRuntimeConfig: () => {},
        claimPublication,
        releasePublication,
        refresh: successfulRefresh,
        recordSyncRun: async () => null,
        recordHealth: async (pipeline, status, detail) => {
          health.push({ pipeline, status, run_id: detail?.run_id });
        },
      });

      expect(response.status).toBe(200);
      expect(health).toEqual([
        {
          pipeline: `cron-${job}`,
          status: "ok",
          run_id: `${job}-2026-07-17T03-00-00-000Z`,
        },
      ]);
    });
  }

  test("records and alerts a failure without erasing another pipeline", async () => {
    const health: Array<{ pipeline: AlertPipeline; status: HealthStatus; error?: string }> = [];
    const alerts: AlertSummary[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await runLiveRefreshRoute(request("daily"), "daily", {
        now: new Date("2026-07-17T03:00:00.000Z"),
        requireRuntimeConfig: () => {},
        claimPublication,
        releasePublication,
        refresh: async () => {
          throw new Error("GitHub unavailable");
        },
        recordSyncRun: async () => null,
        sendAlert: async (summary) => {
          alerts.push(summary);
          return { status: "disabled", attempts: 0, status_code: null, error: null };
        },
        recordHealth: async (pipeline, status, detail) => {
          health.push({ pipeline, status, error: detail?.error });
        },
      });

      expect(response.status).toBe(500);
      expect(alerts).toHaveLength(1);
      expect(health).toEqual([
        { pipeline: "cron-daily", status: "failed", error: "GitHub unavailable" },
      ]);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("dry runs do not mutate operational health", async () => {
    const recordHealth = mock(async () => {});
    const response = await runLiveRefreshRoute(request("daily", "?dry=1"), "daily", {
      requireRuntimeConfig: () => {},
      refresh: successfulRefresh,
      recordSyncRun: async () => null,
      recordHealth,
    });

    expect(response.status).toBe(200);
    expect(recordHealth).not.toHaveBeenCalled();
  });
});
