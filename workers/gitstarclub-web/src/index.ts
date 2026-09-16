type RefreshJob = {
  v: 1;
  graph: "full" | "fixture";
  runId: string;
  name: string;
  attempt: number;
  cursor: Record<string, unknown>;
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
};

const FIXTURE_NEXT: Record<string, string | null> = {
  startRun: "writeViews",
  writeViews: "complete",
  complete: null,
};

function unauthorized(): Response {
  return new Response("Unauthorized", { status: 401 });
}

function hasValidBearer(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret || !header.startsWith("Bearer ")) return false;
  return header.slice("Bearer ".length) === secret;
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
    if (!hasValidBearer(request.headers.get("authorization"), env.CRON_SECRET)) {
      return unauthorized();
    }
    if ((url.pathname === "/start" || url.pathname === "/") && (request.method === "GET" || request.method === "POST")) {
      if (env.WORKFLOW_FIXTURE === "1") {
        const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
        await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
        return Response.json({ ok: true, runId, status: "started", graph: "fixture" });
      }
      return triggerStart(env);
    }
    if (url.pathname === "/enqueue" && request.method === "POST") {
      const job = (await request.json()) as RefreshJob;
      await enqueueJob(env, job);
      return Response.json({ ok: true, queued: job.name, runId: job.runId });
    }
    return Response.json({ ok: false, error: "Not found" }, { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    if (env.WORKFLOW_FIXTURE === "1") {
      const runId = `fixture-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
      await enqueueJob(env, { v: 1, graph: "fixture", runId, name: "startRun", attempt: 0, cursor: {} });
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
