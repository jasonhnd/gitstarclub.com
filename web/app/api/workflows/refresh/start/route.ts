import { start } from "workflow/api";
import { refreshWorkflow } from "@/lib/workflows/refresh";

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
  await start(refreshWorkflow, [runId]);
  return Response.json({ ok: true, runId });
}
