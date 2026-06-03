import { refreshLiveViews } from "@/lib/cron/live-refresh";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { recordHealth, sendAlert } from "@/lib/observability/alert";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const startedAt = new Date();
  const id = syncRunId("weekly", startedAt);

  try {
    const result = await refreshLiveViews("weekly", dry);
    const log_error = dry ? null : await safeRecordSyncRun(completedRun(id, "weekly", dry, startedAt, result));
    return Response.json({
      ok: true,
      ...result,
      log_error,
      mode: "vercel-incremental-live-refresh",
    });
  } catch (error) {
    const run = failedRun(id, "weekly", dry, startedAt, error);
    const log_error = dry ? null : await safeRecordSyncRun(run);
    // Surface the failure: greppable log + optional webhook + health beacon (all non-throwing).
    if (!dry) {
      await sendAlert({ pipeline: "cron-weekly", title: "weekly live refresh failed", run_id: id, error: run.error });
      await recordHealth("cron-weekly", "failed", { run_id: id, error: run.error });
    }
    return Response.json({ ok: false, error: run.error, log_error }, { status: 500 });
  }
}

function authorized(req: Request): boolean {
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}
