import { WorkflowStepCheckpoint } from "@/lib/contracts";
import { putView } from "@/lib/data/write";
import { isVercelProduction } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";
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
    await (opts.recordCheckpoint ?? defaultCheckpoint)(job, result);
    const runtime = resolveWorkflowRuntime({
      requestUrl: req.url,
      schedule: opts.schedule,
      fetchImpl: opts.fetchImpl,
      env: opts.env,
      kind: opts.kind,
    });
    await runtime.completeStep(job, result);
    return Response.json({ ok: true, runId: job.runId, step: job.name, result });
  } catch (error) {
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
