import { start } from "workflow/api";
import { refreshWorkflow } from "@/lib/workflows/refresh";
import { sendAlert } from "@/lib/observability/alert";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";

// Cron entrypoint: authorize, start the managed-refresh workflow, return the
// run_id immediately (start() enqueues; it does not block). The long work runs
// in the workflow's durable steps. See docs/OPS.md §Workflow runbook.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const runId = `refresh-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  try {
    requireBlobBaseUrl();
    requireBlobWriteToken();
    requireGithubToken();
    await start(refreshWorkflow, [runId]);
  } catch (error) {
    // Enqueue failed: the workflow body never runs, so markFailed won't fire here.
    // Alert directly so this otherwise-silent gap is observable. sendAlert never throws.
    const message = error instanceof Error ? error.message : String(error);
    await sendAlert({ pipeline: "workflow-refresh", title: "failed to enqueue managed refresh", run_id: runId, step: "start", error: message });
    console.error("[workflow-refresh] failed to enqueue", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }
  return Response.json({ ok: true, runId });
}
