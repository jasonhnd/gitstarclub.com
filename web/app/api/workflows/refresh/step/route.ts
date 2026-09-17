import { after } from "next/server";
import { runRefreshStepRoute } from "@/lib/workflows/runtime";

// One refresh step. The start route and CF Queue consumer POST here with
// CRON_SECRET. Each invocation runs one ordinary async step, then enqueues
// the next. Not a production cron source of truth.

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request): Promise<Response> {
  return runRefreshStepRoute(req, {
    requestUrl: req.url,
    schedule: (task) => {
      after(task);
    },
  });
}
