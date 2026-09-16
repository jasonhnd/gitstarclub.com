import { after } from "next/server";
import { resolveWorkflowRuntime } from "@/lib/workflows/runtime";
import { startRefreshWorkflowRoute } from "@/lib/workflows/start";

// Cron entrypoint: authorize, acquire the lease, enqueue the first refresh step,
// and return the run_id immediately. Production scheduling stays on Vercel cron
// (`web/vercel.json`). The long work is ordinary async steps plus explicit retry,
// advanced by the HTTP chain or a non-production CF Queue. See docs/OPS.md
// and docs/CF-MIGRATION-P1.md.

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return startRefreshWorkflowRoute(req, async (runId) => {
    const runtime = resolveWorkflowRuntime({
      requestUrl: req.url,
      schedule: (task) => {
        after(task);
      },
    });
    await runtime.startRefresh(runId);
  });
}
