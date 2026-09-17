type RefreshJob = {
  v: 1;
  graph: "full" | "fixture";
  runId: string;
  name: string;
  attempt: number;
  cursor: Record<string, unknown>;
};

type InvalidateOp = {
  kind: "path" | "tag";
  path?: string;
  tag?: string;
};

type InvalidateBody = {
  v?: number;
  driver?: string;
  ops?: InvalidateOp[];
  paths?: string[];
  tags?: string[];
};

type Env = {
  JOBS: {
    send(message: RefreshJob): Promise<void>;
  };
  MEDIA: unknown;
  CRON_SECRET?: string;
  REFRESH_START_URL?: string;
  REFRESH_STEP_URL?: string;
  WORKFLOW_FIXTURE?: string;
  CF_PREVIEW_COMMIT_SHA?: string;
  CF_PREVIEW_ORIGIN?: string;
};

const FIXTURE_NEXT: Record<string, string | null> = {
  startRun: "writeViews",
  writeViews: "complete",
  complete: null,
};

const PUBLIC_PREVIEW_PATHS = new Set(["/preview/identity", "/preview/health", "/.well-known/deployment"]);

function emitRunLog(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function hasValidBearer(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || !header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === secret;
}

function previewIdentity(request: Request, env: Env): Record<string, unknown> {
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

async function triggerStart(env: Env): Promise<Response> {
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

async function enqueueJob(env: Env, job: RefreshJob): Promise<void> {
  await env.JOBS.send(job);
}

function nextFixtureJob(job: RefreshJob): RefreshJob | null {
  const name = FIXTURE_NEXT[job.name];
  if (!name) return null;
  return { ...job, name, attempt: 0 };
}

async function consumeJob(env: Env, job: RefreshJob): Promise<void> {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (PUBLIC_PREVIEW_PATHS.has(url.pathname) && request.method === "GET") {
      if (url.pathname === "/preview/health") {
        emitRunLog({ event: "preview.health", host: url.host });
        return Response.json({ ok: true, target: "cf", observability: true });
      }
      const identity = previewIdentity(request, env);
      emitRunLog({ event: "preview.identity", host: url.host, commitSha: identity.commitSha });
      return Response.json(identity);
    }

    if (!hasValidBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
      emitRunLog({ event: "preview.unauthorized", path: url.pathname });
      return unauthorized();
    }

    if ((url.pathname === "/start" || url.pathname === "/") && (request.method === "GET" || request.method === "POST")) {
      if (env.WORKFLOW_FIXTURE === "1") {
        const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
        await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
        emitRunLog({ event: "workflow.start", runId, graph: "fixture" });
        return Response.json({ ok: true, runId, status: "started", graph: "fixture" });
      }
      return triggerStart(env);
    }
    if (url.pathname === "/enqueue" && request.method === "POST") {
      const job = (await request.json()) as RefreshJob;
      await enqueueJob(env, job);
      emitRunLog({ event: "workflow.enqueue", runId: job.runId, step: job.name });
      return Response.json({ ok: true, queued: job.name, runId: job.runId });
    }
    if (url.pathname === "/preview/invalidate" && request.method === "POST") {
      const body = (await request.json()) as InvalidateBody;
      const recorded = recordedOps(body);
      emitRunLog({ event: "cache.invalidate", driver: body.driver ?? "cf-stub", ops: recorded });
      return Response.json({ ok: true, recorded });
    }
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
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
  },

  async queue(batch: { messages: Array<{ body: RefreshJob }> }, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await consumeJob(env, message.body);
    }
  },
};
