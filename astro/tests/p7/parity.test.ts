import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from "bun:test";
import type { APIContext, APIRoute } from "astro";
import { finalizeRouteHandlerResponse } from "../../../web/node_modules/vinext/dist/server/app-route-handler-response.js";
import { NextResponse } from "../../../web/node_modules/next/server";
import * as live from "../../../web/lib/cron/live-refresh";
import * as publication from "../../../web/lib/cron/live-publication";
import * as sync from "../../../web/lib/cron/sync-runs";
import * as health from "../../../web/lib/observability/health";
import * as alert from "../../../web/lib/observability/alert";
import * as cold from "../../../web/lib/workflows/cold-start";
import * as whitelist from "../../../web/lib/workflows/steps/whitelist";
import * as lease from "../../../web/lib/workflows/lease";
import * as rollback from "../../../web/lib/workflows/rollback";
import * as execute from "../../../web/lib/workflows/runtime/execute";
import * as cache from "../../../web/lib/workflows/publication-cache";
import * as write from "../../../web/lib/data/write";
import { corePublicationRevalidatePaths } from "../../../web/lib/data/core-revalidate-paths";
import { withWorkerEnv } from "../../../web/lib/workers-host/runtime-env";
import { GET as daily } from "../../src/pages/api/cron/daily";
import { GET as weekly } from "../../src/pages/api/cron/weekly";
import { GET as language } from "../../src/pages/api/lang";
import { GET as start } from "../../src/pages/api/workflows/refresh/start";
import { POST as step } from "../../src/pages/api/workflows/refresh/step";
import { POST as revalidate } from "../../src/pages/api/workflows/refresh/revalidate";
import { POST as undo } from "../../src/pages/api/workflows/refresh/rollback";
import { firstRefreshJob } from "../../../web/lib/workflows/runtime/types";
import { LOCALES } from "../../src/lib/i18n";

let afterTasks: (() => Promise<void>)[] = [];
// Only replace the old framework lifecycle; keep its real response serializer.
mock.module("next/server", () => ({ NextResponse, after: (task: () => Promise<void>) => afterTasks.push(task) }));
const legacy = {
  daily: (await import("../../../web/app/api/cron/daily/route")).GET,
  weekly: (await import("../../../web/app/api/cron/weekly/route")).GET,
  language: (await import("../../../web/app/api/lang/route")).GET,
  start: (await import("../../../web/app/api/workflows/refresh/start/route")).GET,
  step: (await import("../../../web/app/api/workflows/refresh/step/route")).POST,
  revalidate: (await import("../../../web/app/api/workflows/refresh/revalidate/route")).POST,
  rollback: (await import("../../../web/app/api/workflows/refresh/rollback/route")).POST,
};
const previous = { ...process.env };
const realFetch = globalThis.fetch;
let spies: { mockRestore(): void }[] = [];
const pending: Promise<unknown>[] = [];
const paths: string[][] = [];
const NOW = new Date("2026-07-17T03:00:00.000Z");

beforeEach(() => {
  setSystemTime(NOW);
  Object.assign(process.env, {
    NODE_ENV: "production", CRON_SECRET: "secret", BLOB_BASE_URL: "https://blob.example.com",
    BLOB_READ_WRITE_TOKEN: "fixture-only", GITHUB_TOKEN: "fixture-only", WORKFLOW_RUNTIME: "http",
  });
  globalThis.fetch = mock(async () => { throw new Error("Unexpected network call in P7 parity"); }) as unknown as unknown as typeof fetch;
  pending.length = 0; paths.length = 0; afterTasks = [];
  spies = [
    spyOn(health, "recordHealth").mockResolvedValue(undefined),
    spyOn(alert, "sendAlert").mockResolvedValue({ status: "disabled", attempts: 0, status_code: null, error: null }),
    spyOn(sync, "safeRecordSyncRun").mockResolvedValue(null),
    spyOn(cold, "isUniverseColdStartActive").mockResolvedValue(false),
    spyOn(cold, "readRefreshStartPreflight").mockResolvedValue({} as never),
    spyOn(whitelist, "rememberFailedUnpublishedWhitelist").mockResolvedValue(null),
    spyOn(lease, "claimWorkflowLease").mockImplementation(async (args) => ({
      status: "acquired", lease: { ...args, run_id: args.runId, fencing_token: 7 },
    }) as never),
    spyOn(lease, "releaseWorkflowLease").mockResolvedValue(true),
    spyOn(write, "putView").mockResolvedValue(undefined as never),
  ];
});
afterEach(async () => {
  await Promise.allSettled(pending);
  for (const item of spies) item.mockRestore();
  globalThis.fetch = realFetch;
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
  setSystemTime();
});
function context(request: Request): APIContext {
  return { request, locals: {
    invalidatePaths: async (value: string[]) => { paths.push(value); },
    cfContext: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } },
  } } as unknown as APIContext;
}
function request(path: string, method = "GET", body?: string, headers: HeadersInit = { authorization: "Bearer secret" }) {
  return new Request(`https://local.invalid${path}`, { method, headers, body });
}
async function bytes(response: Response) {
  return { status: response.status, headers: [...response.headers], body: Array.from(new Uint8Array(await response.arrayBuffer())) };
}
async function compare(old: (req: Request) => Response | Promise<Response>, route: APIRoute, req: Request) {
  const expected = await bytes(finalizeRouteHandlerResponse(await old(req.clone()), { pendingCookies: [], isHead: req.method === "HEAD" }));
  const actual = await bytes(await route(context(req.clone())));
  expect(actual).toEqual(expected);
  return actual;
}

for (const [name, route, method] of [
  ["daily", daily, "GET"], ["weekly", weekly, "GET"], ["start", start, "GET"],
  ["step", step, "POST"], ["revalidate", revalidate, "POST"], ["rollback", undo, "POST"],
] as const) {
  test(`${name}: identical missing, malformed and wrong bearer responses`, async () => {
    const path = name === "daily" || name === "weekly" ? `/api/cron/${name}` : `/api/workflows/refresh/${name}`;
    for (const authorization of [undefined, "secret", "bearer secret", "Bearer wrong", "Bearer secret-longer"]) {
      const result = await compare(legacy[name], route, request(path, method, undefined, authorization ? { authorization } : {}));
      expect(result.status).toBe(401);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(paths).toEqual([]);
  });
}

test("language: every header and body byte matches for seven locales and unsafe destinations", async () => {
  for (const lang of [...LOCALES, "invalid", ""]) {
    for (const next of ["/", "/ja/rankings?period=month#top", "/zh-TW/example/repo", "//evil.example", "/fr//evil.example", "/%252f%252fevil.example", "/%0d%0aevil", "relative"]) {
      expect((await compare(legacy.language, language, request(`/api/lang?${new URLSearchParams({ lang, next })}`))).status).toBe(307);
    }
  }
});

for (const [name, route] of [["daily", daily], ["weekly", weekly]] as const) {
  test(`${name}: publication success, dry run, attached, conflict and replay are byte-identical`, async () => {
    spies.push(spyOn(live, "refreshLiveViews").mockImplementation(async (job, dry) => ({ job, dry, generation: dry ? null : "fixture-generation", post_commit_errors: [] }) as never));
    const claim = spyOn(publication, "claimLivePublication"); spies.push(claim);
    for (const query of ["?dry=1", "?idempotency_key=bad%20key", ""]) {
      claim.mockResolvedValue({ status: "acquired", etag: "fixture-etag", previous_generation: null } as never);
      await compare(legacy[name], route, request(`/api/cron/${name}${query}`));
    }
    for (const status of ["attached", "rejected", "committed"] as const) {
      claim.mockResolvedValue({ status, lease: { run_id: "active", expires_at: "2026-07-18T00:00:00Z" }, generation: "gen", pointer: { run_id: "done", generation: "gen", published_at: "2026-07-16T00:00:00Z" } } as never);
      await compare(legacy[name], route, request(`/api/cron/${name}`));
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
}

test("start: invalid query, lease attach/conflict and deferred HTTP successor match", async () => {
  for (const query of ["?dry=1", "?dry=0", "?unknown=1&other=2"]) await compare(legacy.start, start, request(`/api/workflows/refresh/start${query}`));
  const claim = spyOn(lease, "claimWorkflowLease"); spies.push(claim);
  for (const status of ["attached", "rejected"] as const) {
    claim.mockResolvedValue({ status, lease: { run_id: "active", expires_at: "2026-07-18T00:00:00Z" } } as never);
    await compare(legacy.start, start, request("/api/workflows/refresh/start?idempotency_key=fixture"));
  }
  claim.mockResolvedValue({ status: "acquired", lease: { run_id: "fixture", fencing_token: 7 } } as never);
  const posts: unknown[] = [];
  globalThis.fetch = mock(async (url, init) => { posts.push({ url: String(url), ...init }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
  expect((await compare(legacy.start, start, request("/api/workflows/refresh/start?idempotency_key=fixture"))).status).toBe(200);
  expect(afterTasks).toHaveLength(1); expect(pending).toHaveLength(1);
  await Promise.all(pending);
  await afterTasks[0]();
  expect(posts).toHaveLength(2); expect(posts[0]).toEqual(posts[1]);
});

test("step: malformed JSON/job/fixture and a full step successor match", async () => {
  for (const body of ["{", "{}", JSON.stringify(firstRefreshJob("fixture", "fixture"))]) await compare(legacy.step, step, request("/api/workflows/refresh/step", "POST", body));
  spies.push(spyOn(execute, "executeRefreshStep").mockResolvedValue({ name: "startRun" }));
  const posts: unknown[] = [];
  globalThis.fetch = mock(async (url, init) => { posts.push({ url: String(url), ...init }); return new Response(null, { status: 200 }); }) as unknown as typeof fetch;
  expect((await compare(legacy.step, step, request("/api/workflows/refresh/step", "POST", JSON.stringify(firstRefreshJob("fixture"))))).status).toBe(200);
  await Promise.all(pending); await afterTasks[0]();
  expect(posts).toHaveLength(2); expect(posts[0]).toEqual(posts[1]);
});

test("revalidate: identical response, pointer cache tags without page invalidation", async () => {
  const tags: string[] = [];
  await withWorkerEnv({ DEPLOY_ENV: "pre", GSC_CACHE: { put: async (key: string) => { tags.push(key); } } }, async () => {
    const response = await compare(legacy.revalidate, revalidate, request("/api/workflows/refresh/revalidate", "POST"));
    expect(response.status).toBe(200);
  });
  expect(tags.length).toBeGreaterThan(0);
  expect(tags).toHaveLength(116 + 4);
  expect(tags.slice(0, 4)).toEqual(tags.slice(-4));
  expect(paths).toEqual([]);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});

test("rollback: request validation, lease conflicts, success and sanitized failure match", async () => {
  await compare(legacy.rollback, undo, request("/api/workflows/refresh/rollback", "POST", "{}"));
  const req = (body: string) => request("/api/workflows/refresh/rollback", "POST", body, { authorization: "Bearer secret", "idempotency-key": "fixture" });
  for (const body of ["{", "{}", '{"target_version":"v1","extra":1}']) await compare(legacy.rollback, undo, req(body));
  const operation = spyOn(rollback, "rollbackVersion").mockResolvedValue({ version: "v1", previousVersion: "v2", publishedAt: NOW.toISOString() } as never); spies.push(operation);
  await compare(legacy.rollback, undo, req('{"target_version":"v1"}'));
  operation.mockRejectedValue(new Error("token=CANARYsecret"));
  const log = spyOn(console, "error").mockImplementation(() => {}); spies.push(log);
  await compare(legacy.rollback, undo, req('{"target_version":"v1"}'));
  expect(JSON.stringify(log.mock.calls)).not.toContain("CANARY");
  const claim = spyOn(lease, "claimWorkflowLease").mockResolvedValue({ status: "rejected", lease: { run_id: "active", expires_at: NOW.toISOString() } } as never); spies.push(claim);
  expect((await compare(legacy.rollback, undo, req('{"target_version":"v1"}'))).status).toBe(409);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});


test("revalidation awaits pointer invalidation and propagates its failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((done) => { release = done; });
  const invalidation = spyOn(cache, "invalidatePublishedViews").mockReturnValue(gate); spies.push(invalidation);
  const ctx = context(request("/api/workflows/refresh/revalidate", "POST"));
  ctx.locals.invalidatePaths = async () => { throw new Error("publication must not invalidate page paths"); };
  let completed = false;
  const response = Promise.resolve(revalidate(ctx)).then((value) => { completed = true; return value; });
  await Bun.sleep(0);
  expect(completed).toBe(false);
  release(); expect((await response).status).toBe(200);
  invalidation.mockRejectedValue(new Error("data cache unavailable"));
  await expect(Promise.resolve(legacy.revalidate(ctx.request.clone()))).rejects.toThrow("data cache unavailable");
  await expect(Promise.resolve(revalidate(ctx))).rejects.toThrow("data cache unavailable");
});

test("full core publication callback uses four delayed KV writes within five seconds", async () => {
  // At 200 ms/put, the old 172 serial writes require at least 34.4 seconds.
  expect(corePublicationRevalidatePaths()).toHaveLength(56);
  const tags: string[] = [];
  const started = performance.now();
  await withWorkerEnv({ DEPLOY_ENV: "pre", GSC_CACHE: { put: async (key: string) => {
    tags.push(key);
    await Bun.sleep(200);
  } } }, async () => {
    const ctx = context(request("/api/workflows/refresh/revalidate", "POST"));
    ctx.locals.invalidatePaths = async () => { throw new Error("unexpected page invalidation"); };
    const response = await revalidate(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
  expect(tags).toHaveLength(4);
  expect(new Set(tags).size).toBe(4);
  expect(performance.now() - started).toBeLessThan(5000);
}, 6000);
