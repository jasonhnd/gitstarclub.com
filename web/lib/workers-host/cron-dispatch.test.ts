import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN,
  CRON_DAILY,
  CRON_DAILY_PATH,
  CRON_REFRESH,
  CRON_REFRESH_ALIASES,
  CRON_REFRESH_CF,
  CRON_REFRESH_PATH,
  CRON_REFRESH_SUN,
  CRON_WEEKLY,
  CRON_WEEKLY_ALIASES,
  CRON_WEEKLY_CF,
  CRON_WEEKLY_PATH,
  CRON_WEEKLY_SUN,
  cronHttpUrl,
  planCronDispatch,
  PREVIEW_CRON_ORIGIN,
  PREVIEW_CRON_TRIGGERS,
  PRODUCTION_CRON_ORIGIN,
  resolveCronOrigin,
  resolveRefreshStartUrl,
} from "../../../workers/gitstarclub-web/src/cron-dispatch";
import type { RefreshJob, WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { handleScheduled } from "../../../workers/gitstarclub-web/src/shell";

const originalFetch = globalThis.fetch;

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    JOBS: { send: async () => undefined },
    MEDIA: null,
    CRON_SECRET: "test-cron-secret",
    CF_CRON_ORIGIN: PREVIEW_CRON_ORIGIN,
    ...overrides,
  };
}

describe("CF cron dispatch plan", () => {
  test("maps the three Vercel-parity expressions", () => {
    expect(planCronDispatch(CRON_DAILY)).toEqual({ kind: "daily", path: CRON_DAILY_PATH });
    expect(planCronDispatch(CRON_WEEKLY)).toEqual({ kind: "weekly", path: CRON_WEEKLY_PATH });
    expect(planCronDispatch(CRON_REFRESH)).toEqual({ kind: "refresh", path: CRON_REFRESH_PATH });
    expect([...PREVIEW_CRON_TRIGGERS]).toEqual([CRON_DAILY, CRON_WEEKLY, CRON_REFRESH]);
  });

  test("weekly and refresh accept Sunday DoW 0, 7, and SUN", () => {
    expect([...CRON_WEEKLY_ALIASES]).toEqual([CRON_WEEKLY, CRON_WEEKLY_CF, CRON_WEEKLY_SUN]);
    expect([...CRON_REFRESH_ALIASES]).toEqual([CRON_REFRESH, CRON_REFRESH_CF, CRON_REFRESH_SUN]);
    for (const cron of CRON_WEEKLY_ALIASES) {
      expect(planCronDispatch(cron)).toEqual({ kind: "weekly", path: CRON_WEEKLY_PATH });
    }
    for (const cron of CRON_REFRESH_ALIASES) {
      expect(planCronDispatch(cron)).toEqual({ kind: "refresh", path: CRON_REFRESH_PATH });
    }
    expect(planCronDispatch("0 4 * * sun")).toEqual({ kind: "weekly", path: CRON_WEEKLY_PATH });
    expect(planCronDispatch("0 6 * * Sun")).toEqual({ kind: "refresh", path: CRON_REFRESH_PATH });
    expect(planCronDispatch(CRON_DAILY)).toEqual({ kind: "daily", path: CRON_DAILY_PATH });
  });

  test("treats unknown expressions as an observable failure plan", () => {
    expect(planCronDispatch("0 1 * * *")).toEqual({ kind: "unknown", cron: "0 1 * * *" });
    expect(planCronDispatch("0 4 * * 1")).toEqual({ kind: "unknown", cron: "0 4 * * 1" });
    expect(planCronDispatch("0 4 * * 6")).toEqual({ kind: "unknown", cron: "0 4 * * 6" });
    expect(planCronDispatch("0 3 * * 7")).toEqual({ kind: "unknown", cron: "0 3 * * 7" });
    expect(planCronDispatch("")).toEqual({ kind: "unknown", cron: "" });
  });
});

describe("CF cron origin", () => {
  test("reads CF_CRON_ORIGIN and does not guess a host", () => {
    expect(resolveCronOrigin({ CF_CRON_ORIGIN: `${PREVIEW_CRON_ORIGIN}/` })).toBe(PREVIEW_CRON_ORIGIN);
    expect(resolveCronOrigin({ CF_CRON_ORIGIN: PRODUCTION_CRON_ORIGIN })).toBe(PRODUCTION_CRON_ORIGIN);
    expect(cronHttpUrl({ CF_CRON_ORIGIN: PREVIEW_CRON_ORIGIN }, CRON_DAILY_PATH)).toBe(
      `${PREVIEW_CRON_ORIGIN}${CRON_DAILY_PATH}`,
    );
    expect(() => resolveCronOrigin({})).toThrow("CF_CRON_ORIGIN is required");
    expect(() => resolveCronOrigin({ CF_CRON_ORIGIN: CLOSED_PRODUCTION_WORKERS_DEV_ORIGIN })).toThrow(
      "closed production workers.dev",
    );
  });

  test("refresh start prefers REFRESH_START_URL then CF_CRON_ORIGIN", () => {
    expect(
      resolveRefreshStartUrl({
        REFRESH_START_URL: "https://pre.gitstarclub.com/api/workflows/refresh/start",
        CF_CRON_ORIGIN: PRODUCTION_CRON_ORIGIN,
      }),
    ).toBe("https://pre.gitstarclub.com/api/workflows/refresh/start");
    expect(resolveRefreshStartUrl({ CF_CRON_ORIGIN: PREVIEW_CRON_ORIGIN })).toBe(
      `${PREVIEW_CRON_ORIGIN}${CRON_REFRESH_PATH}`,
    );
    expect(() => resolveRefreshStartUrl({})).toThrow("CF_CRON_ORIGIN is required");
  });
});

describe("handleScheduled dispatch", () => {
  test("daily and weekly call the matching Next routes with Bearer CRON_SECRET", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    stubFetch(
      mock((input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), auth: headers.get("authorization") });
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await handleScheduled({ cron: CRON_DAILY }, makeEnv());
    await handleScheduled(
      { cron: CRON_WEEKLY },
      makeEnv({ CF_CRON_ORIGIN: PRODUCTION_CRON_ORIGIN }),
    );
    await handleScheduled({ cron: CRON_WEEKLY_CF }, makeEnv());
    await handleScheduled({ cron: CRON_WEEKLY_SUN }, makeEnv());

    expect(calls).toEqual([
      { url: `${PREVIEW_CRON_ORIGIN}${CRON_DAILY_PATH}`, auth: "Bearer test-cron-secret" },
      { url: `${PRODUCTION_CRON_ORIGIN}${CRON_WEEKLY_PATH}`, auth: "Bearer test-cron-secret" },
      { url: `${PREVIEW_CRON_ORIGIN}${CRON_WEEKLY_PATH}`, auth: "Bearer test-cron-secret" },
      { url: `${PREVIEW_CRON_ORIGIN}${CRON_WEEKLY_PATH}`, auth: "Bearer test-cron-secret" },
    ]);
  });

  test("WORKFLOW_FIXTURE does not hijack daily or weekly", async () => {
    const queued: RefreshJob[] = [];
    const calls: string[] = [];
    stubFetch(
      mock((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await handleScheduled(
      { cron: CRON_DAILY },
      makeEnv({
        WORKFLOW_FIXTURE: "1",
        JOBS: { send: async (job) => { queued.push(job); } },
      }),
    );

    expect(queued).toEqual([]);
    expect(calls).toEqual([`${PREVIEW_CRON_ORIGIN}${CRON_DAILY_PATH}`]);
  });

  test("refresh uses triggerStart or the fixture queue", async () => {
    const queued: RefreshJob[] = [];
    const calls: string[] = [];
    stubFetch(
      mock((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await handleScheduled(
      { cron: CRON_REFRESH },
      makeEnv({ REFRESH_START_URL: "https://pre.gitstarclub.com/custom/start" }),
    );
    await handleScheduled({ cron: CRON_REFRESH }, makeEnv());
    await handleScheduled({ cron: CRON_REFRESH_CF }, makeEnv());
    await handleScheduled({ cron: CRON_REFRESH_SUN }, makeEnv());
    await handleScheduled(
      { cron: CRON_REFRESH_CF },
      makeEnv({
        WORKFLOW_FIXTURE: "1",
        JOBS: { send: async (job) => { queued.push(job); } },
      }),
    );

    expect(calls).toEqual([
      "https://pre.gitstarclub.com/custom/start",
      `${PREVIEW_CRON_ORIGIN}${CRON_REFRESH_PATH}`,
      `${PREVIEW_CRON_ORIGIN}${CRON_REFRESH_PATH}`,
      `${PREVIEW_CRON_ORIGIN}${CRON_REFRESH_PATH}`,
    ]);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ v: 1, graph: "fixture", name: "startRun" });
  });

  test("unknown cron and failed HTTP are observable failures", async () => {
    stubFetch(mock(() => Promise.resolve(new Response("nope", { status: 401 }))) as unknown as typeof fetch);

    await expect(handleScheduled({ cron: "15 1 * * *" }, makeEnv())).rejects.toThrow(
      "unknown CF cron expression: 15 1 * * *",
    );
    await expect(handleScheduled({ cron: CRON_DAILY }, makeEnv())).rejects.toThrow("CF cron daily failed: HTTP 401");
    await expect(handleScheduled({ cron: CRON_DAILY }, makeEnv({ CF_CRON_ORIGIN: undefined }))).rejects.toThrow(
      "CF_CRON_ORIGIN is required",
    );
  });
});
