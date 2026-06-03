import { start } from "workflow/api";
import { refreshWorkflow } from "@/lib/workflows/refresh";
import { sendAlert } from "@/lib/observability/alert";

// Cron entrypoint: authorize, start the managed-refresh workflow, return the
// run_id immediately (start() enqueues; it does not block). The long work runs
// in the workflow's durable steps. See docs/OPS.md §Workflow runbook.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const runId = `refresh-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
  try {
    await start(refreshWorkflow, [runId]);
  } catch (error) {
    // Enqueue failed: the workflow body never runs, so markFailed won't fire here.
    // Alert directly so this otherwise-silent gap is observable. sendAlert never throws.
    const message = error instanceof Error ? error.message : String(error);
    await sendAlert({ pipeline: "workflow-refresh", title: "failed to enqueue managed refresh", run_id: runId, step: "start", error: message });
    return Response.json({ ok: false, runId, error: message }, { status: 500 });
  }
  return Response.json({ ok: true, runId });
}
