import { fetchRefreshStep, refreshStepFetchVia } from "../../../web/lib/workers-host/refresh-step-fetch";
import {
  cronHttpUrl,
  planCronDispatch,
  resolveRefreshStartUrl,
} from "./cron-dispatch";
import type { InvalidateBody, InvalidateOp, RefreshJob, WorkerEnv } from "./env";

const FIXTURE_NEXT: Record<string, string | null> = {
  startRun: "writeViews",
  writeViews: "complete",
  complete: null,
};

export function emitRunLog(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function hasValidBearer(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || !header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === secret;
}

export function previewIdentity(request: Request, env: WorkerEnv): Record<string, unknown> {
  const url = new URL(request.url);
  const deploymentUrl = (env.CF_PREVIEW_ORIGIN ?? url.origin).replace(/\/+$/, "");
  return {
    commitSha: env.CF_PREVIEW_COMMIT_SHA ?? null,
    deploymentUrl,
    target: "cf",
    host: url.host,
  };
}

function recordedOps(body: InvalidateBody): InvalidateOp[] {
  const ops = [...(body.ops ?? [])];
  for (const path of body.paths ?? []) ops.push({ kind: "path", path });
  for (const tag of body.tags ?? []) ops.push({ kind: "tag", tag });
  return ops;
}

async function triggerAuthorizedGet(env: WorkerEnv, url: string): Promise<Response> {
  if (!env.CRON_SECRET) {
    return Response.json({ ok: false, error: "CRON_SECRET is required" }, { status: 500 });
  }
  const response = await fetch(url, {
    method: "GET",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}

async function triggerStart(env: WorkerEnv): Promise<Response> {
  let startUrl: string;
  try {
    startUrl = resolveRefreshStartUrl(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "REFRESH_START_URL or CF_CRON_ORIGIN is required";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
  return triggerAuthorizedGet(env, startUrl);
}

export async function enqueueJob(env: WorkerEnv, job: RefreshJob): Promise<void> {
  await env.JOBS.send(job);
}

function nextFixtureJob(job: RefreshJob): RefreshJob | null {
  const name = FIXTURE_NEXT[job.name];
  if (!name) return null;
  return { ...job, name, attempt: 0 };
}

export async function consumeJob(env: WorkerEnv, job: RefreshJob): Promise<void> {
  emitRunLog({
    event: "workflow.step",
    runId: job.runId,
    step: job.name,
    graph: job.graph,
    via: refreshStepFetchVia(env),
  });
  if (env.WORKFLOW_FIXTURE === "1" && job.graph === "fixture") {
    const next = nextFixtureJob(job);
    if (next) await enqueueJob(env, next);
    return;
  }
  const response = await fetchRefreshStep(env, job);
  if (!response.ok) {
    throw new Error(`refresh step ${job.name} failed: HTTP ${response.status}`);
  }
}

export async function handleShellFetch(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  if (pathname === "/preview/health" && request.method === "GET") {
    emitRunLog({ event: "preview.health", host: url.host, hosting: "cf" });
    return Response.json({
      ok: true,
      target: "cf",
      hosting: "opennext",
      observability: true,
    });
  }

  if (
    (pathname === "/preview/identity" || pathname === "/.well-known/deployment") &&
    request.method === "GET"
  ) {
    const identity = previewIdentity(request, env);
    emitRunLog({ event: "preview.identity", host: url.host, commitSha: identity.commitSha });
    return Response.json(identity);
  }

  if (!hasValidBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
    emitRunLog({ event: "preview.unauthorized", path: pathname });
    return unauthorized();
  }

  if (pathname === "/start" && (request.method === "GET" || request.method === "POST")) {
    if (env.WORKFLOW_FIXTURE === "1") {
      const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
      await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
      emitRunLog({ event: "workflow.start", runId, graph: "fixture" });
      return Response.json({ ok: true, runId, status: "started", graph: "fixture" });
    }
    return triggerStart(env);
  }

  if (pathname === "/enqueue" && request.method === "POST") {
    const job = (await request.json()) as RefreshJob;
    await enqueueJob(env, job);
    emitRunLog({ event: "workflow.enqueue", runId: job.runId, step: job.name });
    return Response.json({ ok: true, queued: job.name, runId: job.runId });
  }

  if (pathname === "/preview/invalidate" && request.method === "POST") {
    const body = (await request.json()) as InvalidateBody;
    const recorded = recordedOps(body);
    emitRunLog({ event: "cache.invalidate", driver: body.driver ?? "cf-stub", ops: recorded });
    return Response.json({ ok: true, recorded });
  }

  return Response.json({ ok: false, error: "Not found" }, { status: 404 });
}

async function enqueueFixtureStart(env: WorkerEnv, cron: string): Promise<void> {
  const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
  emitRunLog({ event: "workflow.cron", cron, runId, graph: "fixture", kind: "refresh" });
}

async function assertCronHttpOk(kind: "daily" | "weekly" | "refresh", response: Response): Promise<void> {
  if (response.ok) return;
  throw new Error(`CF cron ${kind} failed: HTTP ${response.status}`);
}

export async function handleScheduled(event: { cron: string }, env: WorkerEnv): Promise<void> {
  const plan = planCronDispatch(event.cron);
  switch (plan.kind) {
    case "daily":
    case "weekly": {
      const url = cronHttpUrl(env, plan.path);
      const response = await triggerAuthorizedGet(env, url);
      emitRunLog({ event: "workflow.cron", cron: event.cron, kind: plan.kind, status: response.status, url });
      await assertCronHttpOk(plan.kind, response);
      return;
    }
    case "refresh": {
      if (env.WORKFLOW_FIXTURE === "1") {
        await enqueueFixtureStart(env, event.cron);
        return;
      }
      const response = await triggerStart(env);
      emitRunLog({ event: "workflow.cron", cron: event.cron, kind: "refresh", status: response.status });
      await assertCronHttpOk("refresh", response);
      return;
    }
    case "unknown": {
      emitRunLog({ event: "workflow.cron", cron: event.cron, kind: "unknown", ok: false });
      throw new Error(`unknown CF cron expression: ${event.cron}`);
    }
    default: {
      const _exhaustive: never = plan;
      throw new Error(`unhandled CF cron dispatch: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export async function handleQueue(batch: { messages: Array<{ body: RefreshJob }> }, env: WorkerEnv): Promise<void> {
  for (const message of batch.messages) {
    await consumeJob(env, message.body);
  }
}
