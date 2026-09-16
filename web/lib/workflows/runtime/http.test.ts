import { describe, expect, test } from "bun:test";
import { HttpWorkflowRuntime } from "./http";
import { firstRefreshJob } from "./types";

describe("HTTP workflow runtime", () => {
  test("startRefresh schedules a POST to the step route", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const scheduled: Array<() => Promise<void>> = [];
    const runtime = new HttpWorkflowRuntime({
      baseUrl: "https://pre.example.com",
      secret: "cron-secret",
      bypassSecret: "bypass",
      schedule: (task) => {
        scheduled.push(task);
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await runtime.startRefresh("refresh-http");
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://pre.example.com/api/workflows/refresh/step");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("authorization")).toBe("Bearer cron-secret");
    expect(headers.get("x-vercel-protection-bypass")).toBe("bypass");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(firstRefreshJob("refresh-http"));
  });

  test("completeStep enqueues the next job", async () => {
    const bodies: unknown[] = [];
    const runtime = new HttpWorkflowRuntime({
      baseUrl: "https://pre.example.com",
      secret: "cron-secret",
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });

    await runtime.completeStep(firstRefreshJob("refresh-http", "fixture"), {
      name: "startRun",
      startedAt: "2026-09-16T00:00:00.000Z",
      fencingToken: 3,
    });
    expect(bodies).toEqual([
      {
        v: 1,
        graph: "fixture",
        runId: "refresh-http",
        name: "writeViews",
        attempt: 0,
        cursor: { startedAt: "2026-09-16T00:00:00.000Z", fencingToken: 3 },
      },
    ]);
  });
});
