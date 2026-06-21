import { refreshLiveViews } from "@/lib/cron/live-refresh";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { hasValidBearerToken, internalFailurePayload } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  if (!hasValidBearerToken(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });

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
    console.error("[cron-weekly] failed", { run_id: id, error: run.error, log_error });
    return Response.json(internalFailurePayload(id), { status: 500 });
  }
}
