import { refreshLiveViews, type LiveRefreshJob } from "@/lib/cron/live-refresh";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";

export async function runLiveRefreshRoute(req: Request, job: LiveRefreshJob): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const startedAt = new Date();
  const id = syncRunId(job, startedAt);

  try {
    requireBlobBaseUrl();
    requireGithubToken();
    if (!dry) requireBlobWriteToken();

    const result = await refreshLiveViews(job, dry);
    const log_error = dry ? null : await safeRecordSyncRun(completedRun(id, job, dry, startedAt, result));
    return Response.json({
      ok: true,
      ...result,
      log_error,
      ...(job === "weekly" ? { mode: "vercel-incremental-live-refresh" } : {}),
    });
  } catch (error) {
    const run = failedRun(id, job, dry, startedAt, error);
    const log_error = dry ? null : await safeRecordSyncRun(run);
    const pipeline = `cron-${job}` as const;

    // Surface the failure: greppable log + optional webhook + health beacon (all non-throwing).
    if (!dry) {
      await sendAlert({ pipeline, title: `${job} live refresh failed`, run_id: id, error: run.error });
      await recordHealth(pipeline, "failed", { run_id: id, error: run.error });
    }
    console.error(`[cron-${job}] failed`, { run_id: id, error: run.error, log_error });
    return Response.json(internalFailurePayload(id), { status: 500 });
  }
}

