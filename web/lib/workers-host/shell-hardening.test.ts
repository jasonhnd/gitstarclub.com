import * as crypto from "node:crypto";
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { securityHeaders } from "../csp";
import type { RefreshJob, WorkerEnv } from "../../../workers/gitstarclub-web/src/env";
import { handleShellFetch } from "../../../workers/gitstarclub-web/src/shell";

const SECRET = "cron-secret-value";
const timingSafeEqual = spyOn(crypto, "timingSafeEqual");

function workerEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    JOBS: {
      send: async () => {},
    },
    MEDIA: {},
    ...overrides,
  };
}

function shellRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://gitstarclub.com${path}`, init);
}

function authorized(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${SECRET}`);
  return shellRequest(path, { ...init, headers });
}

async function expectUnauthorized(response: Response): Promise<void> {
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("Unauthorized");
  expectSecurityHeaders(response);
}

function expectSecurityHeaders(response: Response): void {
  for (const header of securityHeaders) {
    expect(response.headers.get(header.key)).toBe(header.value);
  }
  const scriptSrc = (response.headers.get("Content-Security-Policy") ?? "")
    .split("; ")
    .find((directive) => directive.startsWith("script-src "));
  expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline'");
  expect(scriptSrc).not.toContain("'nonce-");
  expect(scriptSrc).not.toContain("'sha256-");
  expect(scriptSrc).not.toContain("'strict-dynamic'");
}

describe("Worker shell CRON_SECRET", () => {
  const previousSecret = process.env.CRON_SECRET;

  afterEach(() => {
    timingSafeEqual.mockClear();
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  test("rejects a missing Worker secret even when process.env.CRON_SECRET matches", async () => {
    process.env.CRON_SECRET = SECRET;
    const env = workerEnv();
    await expectUnauthorized(await handleShellFetch(authorized("/start"), env));
    await expectUnauthorized(await handleShellFetch(authorized("/enqueue", { method: "POST" }), env));
    await expectUnauthorized(
      await handleShellFetch(authorized("/preview/invalidate", { method: "POST" }), env),
    );
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  test("rejects an empty Worker secret", async () => {
    const response = await handleShellFetch(authorized("/start"), workerEnv({ CRON_SECRET: "" }));
    await expectUnauthorized(response);
    expect(timingSafeEqual).not.toHaveBeenCalled();
  });

  test("rejects a missing, malformed, or unequal bearer with constant-time comparison", async () => {
    const env = workerEnv({ CRON_SECRET: SECRET });
    await expectUnauthorized(await handleShellFetch(shellRequest("/start"), env));
    await expectUnauthorized(await handleShellFetch(shellRequest("/enqueue", {
      method: "POST",
      headers: { authorization: `bearer ${SECRET}` },
    }), env));
    await expectUnauthorized(await handleShellFetch(shellRequest("/preview/invalidate", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}-extra` },
    }), env));

    timingSafeEqual.mockClear();
    const sameLength = "cron-secret-valuX";
    expect(sameLength.length).toBe(SECRET.length);
    await expectUnauthorized(await handleShellFetch(shellRequest("/start", {
      headers: { authorization: `Bearer ${sameLength}` },
    }), env));
    expect(timingSafeEqual).toHaveBeenCalled();
  });

  test("accepts an exact bearer match on the guarded shell routes", async () => {
    const sent: RefreshJob[] = [];
    const env = workerEnv({
      CRON_SECRET: SECRET,
      WORKFLOW_FIXTURE: "1",
      JOBS: {
        async send(message: RefreshJob): Promise<void> {
          sent.push(message);
        },
      },
    });

    const start = await handleShellFetch(authorized("/start"), env);
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ ok: true, status: "started", graph: "fixture" });
    expect(sent).toHaveLength(1);
    expect(timingSafeEqual).toHaveBeenCalled();

    const enqueue = await handleShellFetch(authorized("/enqueue", {
      method: "POST",
      body: JSON.stringify({ v: 1, graph: "fixture", runId: "run-1", name: "startRun", attempt: 0, cursor: {} }),
    }), env);
    expect(enqueue.status).toBe(200);
    expect(await enqueue.json()).toEqual({ ok: true, queued: "startRun", runId: "run-1" });

    const invalidate = await handleShellFetch(authorized("/preview/invalidate", {
      method: "POST",
      body: JSON.stringify({ paths: ["/"] }),
    }), env);
    expect(invalidate.status).toBe(200);
    expect(await invalidate.json()).toEqual({ ok: true, recorded: [{ kind: "path", path: "/" }] });
  });
});

describe("Worker shell security headers", () => {
  test("adds the shared header set to public shell responses", async () => {
    const env = workerEnv({ VERCEL_GIT_COMMIT_SHA: "abc123" });
    const health = await handleShellFetch(shellRequest("/preview/health"), env);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    expect(await health.json()).toEqual({
      ok: true,
      target: "cf",
      hosting: "opennext",
      observability: true,
    });
    expectSecurityHeaders(health);

    const deployment = await handleShellFetch(shellRequest("/.well-known/deployment"), env);
    expect(deployment.status).toBe(200);
    expect(await deployment.json()).toMatchObject({ commitSha: "abc123", target: "cf" });
    expectSecurityHeaders(deployment);

    const identity = await handleShellFetch(shellRequest("/preview/identity"), env);
    expect(identity.status).toBe(200);
    expectSecurityHeaders(identity);
  });
});
