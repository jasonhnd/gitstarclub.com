import { start } from "workflow/api";
import { refreshWorkflow } from "@/lib/workflows/refresh";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";
import { acquireWorkflowLease, workflowRunId, workflowTriggerPeriod } from "@/lib/workflows/lease";
import { markStartFailed } from "@/lib/workflows/checkpoint";

// Cron entrypoint: authorize, acquire the managed-refresh lease, start the
// workflow when this trigger owns the lease, and return the run_id immediately.
// start() enqueues; it does not block. The long work runs in durable steps.
// See docs/OPS.md §Workflow runbook.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const now = new Date();
  const runId = workflowRunId(now);
  const triggerPeriod = workflowTriggerPeriod(now);
  const lease = await acquireWorkflowLease({ runId, triggerPeriod, requestedAt: now });
  if (lease.action === "attached") {
    await recordHealth("workflow-refresh", "attached", {
      run_id: lease.runId,
      trigger_period: lease.triggerPeriod,
      event: "attached",
    });
    return Response.json({ ok: true, runId: lease.runId, period: lease.triggerPeriod, lease: "attached" });
  }
  if (lease.action === "conflict") {
    await recordHealth("workflow-refresh", "rejected", {
      run_id: runId,
      active_run_id: lease.runId,
      trigger_period: triggerPeriod,
      error: lease.reason,
      event: "rejected",
    });
    return Response.json(
      { ok: false, runId, activeRunId: lease.runId, period: triggerPeriod, lease: "rejected", error: lease.reason },
      { status: 409 },
    );
  }

  try {
    await start(refreshWorkflow, [runId, triggerPeriod]);
  } catch (error) {
    // Enqueue failed: the workflow body never runs, so markFailed won't fire here.
    // Alert directly so this otherwise-silent gap is observable. sendAlert never throws.
    const message = error instanceof Error ? error.message : String(error);
    await markStartFailed(runId, message);
    await sendAlert({ pipeline: "workflow-refresh", title: "failed to enqueue managed refresh", run_id: runId, step: "start", error: message });
    console.error("[workflow-refresh] failed to enqueue", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }
  return Response.json({ ok: true, runId, period: triggerPeriod, lease: lease.action });
}
