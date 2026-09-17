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

async function triggerStart(env: WorkerEnv): Promise<Response> {
  const startUrl = env.REFRESH_START_URL;
  if (!startUrl || !env.CRON_SECRET) {
    return Response.json({ ok: false, error: "REFRESH_START_URL and CRON_SECRET are required" }, { status: 500 });
  }
  const response = await fetch(startUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
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
  emitRunLog({ event: "workflow.step", runId: job.runId, step: job.name, graph: job.graph });
  if (env.WORKFLOW_FIXTURE === "1" && job.graph === "fixture") {
    const next = nextFixtureJob(job);
    if (next) await enqueueJob(env, next);
    return;
  }
  const stepUrl = env.REFRESH_STEP_URL;
  if (!stepUrl || !env.CRON_SECRET) {
    throw new Error("REFRESH_STEP_URL and CRON_SECRET are required to consume a refresh step");
  }
  const response = await fetch(stepUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.CRON_SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(job),
  });
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

export async function handleScheduled(env: WorkerEnv): Promise<void> {
  if (env.WORKFLOW_FIXTURE === "1") {
    const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
    await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
    emitRunLog({ event: "workflow.cron", runId, graph: "fixture" });
    return;
  }
  const response = await triggerStart(env);
  if (!response.ok) {
    throw new Error(`CF cron start failed: HTTP ${response.status}`);
  }
}

export async function handleQueue(batch: { messages: Array<{ body: RefreshJob }> }, env: WorkerEnv): Promise<void> {
  for (const message of batch.messages) {
    await consumeJob(env, message.body);
  }
}
