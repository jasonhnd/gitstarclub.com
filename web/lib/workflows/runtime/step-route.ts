import { WorkflowStepCheckpoint } from "@/lib/contracts";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { putView } from "@/lib/data/write";
import { getWorkflowRuntimeKind, isVercelProduction } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";
import {
  encodeSuccessorJobHeader,
  QUEUE_SUCCESSOR_HEADER,
  queueAdvanceFromConsumer,
} from "@/lib/workers-host/queue-advance";
import { foldStepCheckpointName, hasNextFoldWindow } from "@/lib/workflows/steps/fold";
import { nextRefreshJob } from "./graph";
import { withStepRetry, type RetryPolicy } from "./retry";
import { resolveWorkflowRuntime, type ResolveWorkflowRuntimeOptions } from "./resolve";
import { isRefreshStepJob, type RefreshStepJob, type RefreshStepResult } from "./types";

export type RefreshStepRouteOptions = ResolveWorkflowRuntimeOptions & {
  executeFull?: (job: Extract<RefreshStepJob, { graph: "full" }>) => Promise<RefreshStepResult>;
  executeFixture?: (job: Extract<RefreshStepJob, { graph: "fixture" }>) => Promise<RefreshStepResult>;
  recordCheckpoint?: (job: RefreshStepJob, result: RefreshStepResult) => Promise<void>;
  retry?: RetryPolicy;
};

export function refreshStepCheckpointName(job: RefreshStepJob): string {
  if (job.graph === "full" && job.name === "metadata") return `metadata-${job.cursor.bucket ?? 0}`;
  if (job.graph === "full" && job.name === "preflight") return `preflight-${job.cursor.preflightOffset ?? 0}`;
  if (job.graph === "full" && job.name === "fold") return foldStepCheckpointName(job.cursor);
  return job.name;
}

async function defaultCheckpoint(job: RefreshStepJob, result: RefreshStepResult): Promise<void> {
  const step = refreshStepCheckpointName(job);
  const now = new Date().toISOString();
  const checkpoint = WorkflowStepCheckpoint.parse({
    step,
    status: result.error ? "error" : "ok",
    started_at: now,
    finished_at: now,
    files_written: typeof result.files === "number" ? result.files : undefined,
    error: result.error ?? null,
  });
  await putView(`ops/workflows/${job.runId}/steps/${step}.json`, checkpoint);
  if (job.graph === "full" && job.name === "fold" && !hasNextFoldWindow(result)) {
    await putView(
      `ops/workflows/${job.runId}/steps/fold.json`,
      WorkflowStepCheckpoint.parse({ ...checkpoint, step: "fold" }),
    );
  }
}

export async function runRefreshStepRoute(req: Request, opts: RefreshStepRouteOptions = {}): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isRefreshStepJob(body)) {
    return Response.json({ ok: false, error: "Invalid refresh step job" }, { status: 400 });
  }
  const job = body;
  if (job.graph === "fixture") {
    if (isVercelProduction(opts.env) || !opts.executeFixture) {
      return Response.json({ ok: false, error: "Fixture refresh is not allowed on this runtime" }, { status: 400 });
    }
  }

  try {
    const result = await withStepRetry(
      job.name,
      async () => {
        if (job.graph === "fixture") {
          if (!opts.executeFixture) throw new Error("fixture executor is not configured");
          return opts.executeFixture(job);
        }
        if (opts.executeFull) return opts.executeFull(job);
        // Lazy: execute.ts pulls every refresh step. A static import races
        // bun's full `lib/` suite against data/index.ts circular exports.
        const { executeRefreshStep } = await import("./execute");
        return executeRefreshStep(job);
      },
      opts.retry,
    );
    clearViewParseMemo();
    await (opts.recordCheckpoint ?? defaultCheckpoint)(job, result);
    const kind = opts.kind ?? getWorkflowRuntimeKind(opts.env);
    const runtime = resolveWorkflowRuntime({
      requestUrl: req.url,
      schedule: opts.schedule,
      fetchImpl: opts.fetchImpl,
      env: opts.env,
      kind,
    });
    // CF Queue consumer advances via JOBS.send after reading this body. Doing
    // completeStep here POSTs the public /enqueue hop from the same isolate
    // that just finished fold — that hop never landed (queue silent, no
    // error.json). Direct POST /step still completeSteps.
    if (!(kind === "cf-queue" && queueAdvanceFromConsumer(req.headers))) {
      await runtime.completeStep(job, result);
    }
    const headers = new Headers({ "content-type": "application/json" });
    const successor = encodeSuccessorJobHeader(nextRefreshJob(job, result));
    if (successor) headers.set(QUEUE_SUCCESSOR_HEADER, successor);
    return new Response(JSON.stringify({ ok: true, runId: job.runId, step: job.name, result }), {
      status: 200,
      headers,
    });
  } catch (error) {
    clearViewParseMemo();
    try {
      const { failRefreshJob } = await import("./execute");
      await failRefreshJob(job, error);
    } catch (checkpointError) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message}; failed to record/release failed run: ${checkpointError instanceof Error ? checkpointError.message : String(checkpointError)}`,
      );
    }
    const runId = job.runId;
    console.error("[workflow-refresh] step failed", {
      run_id: runId,
      step: job.name,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }
}
