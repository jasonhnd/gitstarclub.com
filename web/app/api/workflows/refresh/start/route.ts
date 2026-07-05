import { start } from "workflow/api";
import { refreshWorkflow } from "@/lib/workflows/refresh";
import { startRefreshWorkflowRoute } from "@/lib/workflows/start";

// Cron entrypoint: authorize, start the managed-refresh workflow, return the
// run_id immediately (start() enqueues; it does not block). The long work runs
// in the workflow's durable steps. See docs/OPS.md §Workflow runbook.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return startRefreshWorkflowRoute(req, async (runId) => {
    await start(refreshWorkflow, [runId]);
  });
}
