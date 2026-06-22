import { refreshLiveViews } from "@/lib/cron/live-refresh";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(req: Request) {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const startedAt = new Date();
  const id = syncRunId("daily", startedAt);

  try {
    const result = await refreshLiveViews("daily", dry);
    const log_error = dry ? null : await safeRecordSyncRun(completedRun(id, "daily", dry, startedAt, result));
    return Response.json({ ok: true, ...result, log_error });
  } catch (error) {
    const run = failedRun(id, "daily", dry, startedAt, error);
    const log_error = dry ? null : await safeRecordSyncRun(run);
    // Surface the failure: greppable log + optional webhook + health beacon (all non-throwing).
    if (!dry) {
      await sendAlert({ pipeline: "cron-daily", title: "daily live refresh failed", run_id: id, error: run.error });
      await recordHealth("cron-daily", "failed", { run_id: id, error: run.error });
    }
    console.error("[cron-daily] failed", { run_id: id, error: run.error, log_error });
    return Response.json(internalFailurePayload(id), { status: 500 });
  }
}
