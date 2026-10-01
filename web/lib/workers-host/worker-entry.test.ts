import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseWranglerJsonc } from "../../../scripts/cf-ci-gates.mjs";
import {
  CRON_DAILY,
  CRON_DAILY_PATH,
  CRON_REFRESH,
  CRON_REFRESH_PATH,
  CRON_WEEKLY,
  CRON_WEEKLY_PATH,
  planCronDispatch,
  PREVIEW_CRON_ORIGIN,
  PREVIEW_CRON_TRIGGERS,
  PRODUCTION_CRON_ORIGIN,
} from "../../../workers/gitstarclub-web/src/cron-dispatch";
import type { InvalidateBody, InvalidateOp, RefreshJob, WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { handleScheduled, handleShellFetch } from "../../../workers/gitstarclub-web/src/shell";

const originalFetch = globalThis.fetch;

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };
type NextCall = {
  request: Request;
  env: WorkerEnv;
  ctx: WaitUntilContext;
  pending: Promise<unknown>;
};
const nextCalls: NextCall[] = [];

mock.module("../../../workers/gitstarclub-web/src/next-app.ts", () => ({
  handleNextRequest(request: Request, env: WorkerEnv, ctx: WaitUntilContext): Response {
    const pending = Promise.resolve("next-wait");
    nextCalls.push({ request, env, ctx, pending });
    ctx.waitUntil(pending);
    return new Response("next-app", { status: 200, headers: { "x-handler": "next" } });
  },
}));

type ExecutionContext = WaitUntilContext;

type WorkerHandlers = {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response>;
  scheduled(event: { cron: string }, env: WorkerEnv): Promise<void>;
  queue(batch: { messages: Array<{ body: RefreshJob }> }, env: WorkerEnv): Promise<void>;
};

const workerEntrySpecifier = "../../../workers/gitstarclub-web/src/index";
const worker = ((await import(workerEntrySpecifier)) as { default: WorkerHandlers }).default;

function stubFetch(impl: typeof fetch): void {
  globalThis.fetch = impl;
}

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    JOBS: { send: async () => undefined },
    MEDIA: null,
    CRON_SECRET: "test-cron-secret",
    CF_CRON_ORIGIN: PREVIEW_CRON_ORIGIN,
    ...overrides,
  };
}

function shellRequest(pathname: string, method = "GET", body?: string): Request {
  return new Request(`https://pre.gitstarclub.com${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body,
  });
}

function authed(pathname: string, method = "GET", body?: string, secret = "test-cron-secret"): Request {
  const request = shellRequest(pathname, method, body);
  request.headers.set("authorization", `Bearer ${secret}`);
  return request;
}

beforeEach(() => {
  nextCalls.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("paused and empty CF crons", () => {
  test("production and preview wrangler cron lists stay empty while the intended map remains", () => {
    const wranglerPath = resolve(import.meta.dir, "../../../workers/gitstarclub-web/wrangler.jsonc");
    const wrangler = parseWranglerJsonc(readFileSync(wranglerPath, "utf8")) as {
      triggers?: { crons?: string[] };
      env?: { pre?: { triggers?: { crons?: string[] } } };
    };
    expect(wrangler.triggers?.crons).toEqual([]);
    expect(wrangler.env?.pre?.triggers?.crons).toEqual([]);
    expect([...PREVIEW_CRON_TRIGGERS]).toEqual([CRON_DAILY, CRON_WEEKLY, CRON_REFRESH]);
    expect(PREVIEW_CRON_TRIGGERS.map((cron) => planCronDispatch(cron))).toEqual([
      { kind: "daily", path: CRON_DAILY_PATH },
      { kind: "weekly", path: CRON_WEEKLY_PATH },
      { kind: "refresh", path: CRON_REFRESH_PATH },
    ]);
  });

  test("an empty or blank cron expression fails and does not call fetch", async () => {
    const calls: string[] = [];
    stubFetch(
      mock((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await expect(handleScheduled({ cron: "" }, makeEnv())).rejects.toThrow("unknown CF cron expression: ");
    await expect(handleScheduled({ cron: "   " }, makeEnv())).rejects.toThrow("unknown CF cron expression:    ");
    expect(calls).toEqual([]);
  });

  test("a mapped cron without CRON_SECRET fails before fetch", async () => {
    const calls: string[] = [];
    stubFetch(
      mock((input: RequestInfo | URL) => {
        calls.push(String(input));
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await expect(handleScheduled({ cron: CRON_DAILY }, makeEnv({ CRON_SECRET: undefined }))).rejects.toThrow(
      "CF cron daily failed: HTTP 500",
    );
    await expect(handleScheduled({ cron: CRON_WEEKLY }, makeEnv({ CRON_SECRET: "" }))).rejects.toThrow(
      "CF cron weekly failed: HTTP 500",
    );
    expect(calls).toEqual([]);
  });

  test("refresh failure and a missing origin are observable", async () => {
    stubFetch(mock(() => Promise.resolve(new Response("nope", { status: 502 }))) as unknown as typeof fetch);

    await expect(handleScheduled({ cron: CRON_REFRESH }, makeEnv())).rejects.toThrow(
      "CF cron refresh failed: HTTP 502",
    );
    await expect(
      handleScheduled({ cron: CRON_REFRESH }, makeEnv({ CF_CRON_ORIGIN: "   ", REFRESH_START_URL: "  " })),
    ).rejects.toThrow("CF cron refresh failed: HTTP 500");
  });
});

describe("shell fetch routing", () => {
  test("public GET routes answer without a bearer token", async () => {
    const health = await handleShellFetch(shellRequest("/preview/health/"), makeEnv());
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      target: "cf",
      hosting: "opennext",
      observability: true,
    });

    const identity = await handleShellFetch(
      shellRequest("/.well-known/deployment"),
      makeEnv({ VERCEL_GIT_COMMIT_SHA: "abc123", CF_PREVIEW_ORIGIN: "https://pre.gitstarclub.com/" }),
    );
    expect(identity.status).toBe(200);
    expect(await identity.json()).toMatchObject({
      commitSha: "abc123",
      deploymentUrl: "https://pre.gitstarclub.com",
      target: "cf",
      host: "pre.gitstarclub.com",
    });
  });

  test("protected shell routes reject a missing, blank, or non-bearer secret", async () => {
    for (const request of [
      shellRequest("/start", "POST"),
      authed("/enqueue", "POST", "{}", ""),
      shellRequest("/preview/invalidate", "POST", "{}"),
    ]) {
      const response = await handleShellFetch(request, makeEnv());
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("Unauthorized");
    }

    const lowercase = shellRequest("/start", "POST");
    lowercase.headers.set("authorization", "bearer test-cron-secret");
    const response = await handleShellFetch(lowercase, makeEnv());
    expect(response.status).toBe(401);
  });

  test("authorized /start enqueues a fixture or calls the refresh URL with the bearer", async () => {
    const queued: RefreshJob[] = [];
    const calls: Array<{ url: string; auth: string | null; method: string }> = [];
    stubFetch(
      mock((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          auth: new Headers(init?.headers).get("authorization"),
          method: init?.method ?? "GET",
        });
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true, runId: "live" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }) as unknown as typeof fetch,
    );

    const fixture = await handleShellFetch(
      authed("/start/", "POST"),
      makeEnv({
        WORKFLOW_FIXTURE: "1",
        JOBS: { send: async (job) => { queued.push(job); } },
      }),
    );
    expect(fixture.status).toBe(200);
    const fixtureBody = (await fixture.json()) as { ok: boolean; graph: string; runId: string };
    expect(fixtureBody.ok).toBe(true);
    expect(fixtureBody.graph).toBe("fixture");
    expect(fixtureBody.runId.startsWith("fixture-")).toBe(true);
    expect(queued[0]).toMatchObject({ v: 1, graph: "fixture", name: "startRun", attempt: 0 });

    const live = await handleShellFetch(authed("/start", "GET"), makeEnv());
    expect(live.status).toBe(200);
    expect(calls).toEqual([
      {
        url: `${PREVIEW_CRON_ORIGIN}${CRON_REFRESH_PATH}`,
        auth: "Bearer test-cron-secret",
        method: "GET",
      },
    ]);
  });

  test("authorized /start fails closed without a secret and returns 500 without an origin", async () => {
    const missingSecret = await handleShellFetch(shellRequest("/start", "POST"), makeEnv({ CRON_SECRET: undefined }));
    expect(missingSecret.status).toBe(401);
    expect(await missingSecret.text()).toBe("Unauthorized");

    const missingOrigin = await handleShellFetch(
      authed("/start", "GET"),
      makeEnv({ CF_CRON_ORIGIN: undefined, REFRESH_START_URL: undefined }),
    );
    expect(missingOrigin.status).toBe(500);
    const originBody = (await missingOrigin.json()) as { ok: boolean; error: string };
    expect(originBody.ok).toBe(false);
    expect(originBody.error).toContain("CF_CRON_ORIGIN is required");
  });

  test("authorized /enqueue and /preview/invalidate record the job and the ops", async () => {
    const queued: RefreshJob[] = [];
    const job: RefreshJob = { v: 1, graph: "full", runId: "run-1", name: "fold", attempt: 1, cursor: { n: 1 } };
    const enqueued = await handleShellFetch(
      authed("/enqueue", "POST", JSON.stringify(job)),
      makeEnv({ JOBS: { send: async (message) => { queued.push(message); } } }),
    );
    expect(enqueued.status).toBe(200);
    expect(await enqueued.json()).toEqual({ ok: true, queued: "fold", runId: "run-1" });
    expect(queued).toEqual([job]);

    const body: InvalidateBody = {
      driver: "cf-stub",
      ops: [{ kind: "tag", tag: "manual" }],
      paths: ["/rankings"],
      tags: ["views"],
    };
    const invalidated = await handleShellFetch(
      authed("/preview/invalidate", "POST", JSON.stringify(body)),
      makeEnv(),
    );
    expect(await invalidated.json()).toEqual({
      ok: true,
      recorded: [
        { kind: "tag", tag: "manual" },
        { kind: "path", path: "/rankings" },
        { kind: "tag", tag: "views" },
      ] satisfies InvalidateOp[],
    });
  });

  test("an authorized unknown shell path is 404", async () => {
    const response = await handleShellFetch(authed("/preview/missing", "GET"), makeEnv());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found" });
  });
});

describe("Worker entry fetch, scheduled, and queue", () => {
  test("shell paths stay on the shell and other paths go to Next", async () => {
    const received: Promise<unknown>[] = [];
    const ctx: WaitUntilContext = {
      waitUntil(promise: Promise<unknown>) {
        received.push(promise);
      },
    };
    const env = makeEnv();
    const health = await worker.fetch(shellRequest("/preview/health"), env, ctx);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, hosting: "opennext" });
    expect(nextCalls).toEqual([]);
    expect(received).toEqual([]);

    const pageRequest = shellRequest("/rankings");
    const page = await worker.fetch(pageRequest, env, ctx);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("next-app");
    expect(page.headers.get("x-handler")).toBe("next");
    expect(nextCalls).toHaveLength(1);
    expect(nextCalls[0].request).toBe(pageRequest);
    expect(nextCalls[0].env).toBe(env);
    expect(nextCalls[0].ctx).toBe(ctx);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(nextCalls[0].pending);
    expect(await received[0]).toBe("next-wait");
  });

  test("scheduled passes the bearer and queue drains fixture jobs", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    stubFetch(
      mock((input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof fetch,
    );

    await worker.scheduled({ cron: CRON_DAILY }, makeEnv({ CF_CRON_ORIGIN: PRODUCTION_CRON_ORIGIN }));
    expect(calls).toEqual([
      { url: `${PRODUCTION_CRON_ORIGIN}${CRON_DAILY_PATH}`, auth: "Bearer test-cron-secret" },
    ]);

    const queued: RefreshJob[] = [];
    await worker.queue(
      {
        messages: [
          { body: { v: 1, graph: "fixture", runId: "q-1", name: "writeViews", attempt: 0, cursor: {} } },
        ],
      },
      makeEnv({
        WORKFLOW_FIXTURE: "1",
        JOBS: { send: async (job) => { queued.push(job); } },
      }),
    );
    expect(queued.map((job) => job.name)).toEqual(["complete"]);
  });
});

describe("Worker env typing assumptions", () => {
  function assertAssignable<T extends true>(): T {
    return true as T;
  }

  test("RefreshJob, invalidate bodies, and WorkerEnv keep the fields the shell reads", () => {
    assertAssignable<RefreshJob["v"] extends 1 ? true : false>();
    assertAssignable<RefreshJob["graph"] extends "full" | "fixture" ? true : false>();
    assertAssignable<"full" | "fixture" extends RefreshJob["graph"] ? true : false>();
    assertAssignable<WorkerEnv["JOBS"]["send"] extends (message: RefreshJob) => Promise<void> ? true : false>();
    // `{}` is the empty-object assignability probe for required vs optional keys.
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required-key probe
    assertAssignable<{} extends Pick<WorkerEnv, "JOBS"> ? false : true>();
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required-key probe
    assertAssignable<{} extends Pick<WorkerEnv, "MEDIA"> ? false : true>();
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- optional-key probe
    assertAssignable<{} extends Pick<WorkerEnv, "CRON_SECRET"> ? true : false>();
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- optional-key probe
    assertAssignable<{} extends Pick<WorkerEnv, "CF_CRON_ORIGIN"> ? true : false>();
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- optional-key probe
    assertAssignable<{} extends Pick<WorkerEnv, "DATA"> ? true : false>();
    assertAssignable<InvalidateOp["kind"] extends "path" | "tag" ? true : false>();
    assertAssignable<NonNullable<InvalidateBody["ops"]> extends readonly InvalidateOp[] ? true : false>();

    const env: WorkerEnv = { JOBS: { send: async () => undefined }, MEDIA: { bucket: "media" } };
    const job = { v: 1, graph: "fixture", runId: "r", name: "startRun", attempt: 0, cursor: {} } satisfies RefreshJob;
    expect(env.CRON_SECRET).toBeUndefined();
    expect(job.v).toBe(1);
  });
});
