import { refreshLiveViews, type LiveRefreshJob } from "@/lib/cron/live-refresh";
import {
  claimLivePublication,
  releaseLivePublication,
  type LivePublicationStore,
} from "@/lib/cron/live-publication";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { recordHealth, sendAlert } from "@/lib/observability/alert";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";

function requireLiveRefreshRuntimeConfig(dry: boolean): void {
  requireBlobBaseUrl();
  requireGithubToken();
  if (!dry) requireBlobWriteToken();
}

function isRuntimeConfigError(error: unknown): boolean {
  return error instanceof Error && /^(BLOB_BASE_URL|BLOB_READ_WRITE_TOKEN|GITHUB_TOKEN) not set/.test(error.message);
}

export interface LiveRefreshRouteOptions {
  now?: Date;
  publicationStore?: LivePublicationStore;
  refresh?: typeof refreshLiveViews;
}

function liveIdempotencyKey(url: URL, job: LiveRefreshJob, day: string): string | null {
  const provided = url.searchParams.get("idempotency_key");
  const key = provided === null ? `${job}:${day}` : provided;
  return /^[A-Za-z0-9._:-]{1,200}$/.test(key) ? key : null;
}

export async function runLiveRefreshRoute(
  req: Request,
  job: LiveRefreshJob,
  opts: LiveRefreshRouteOptions = {},
): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const startedAt = opts.now ?? new Date();
  const id = syncRunId(job, startedAt);
  const idempotencyKey = liveIdempotencyKey(url, job, startedAt.toISOString().slice(0, 10));
  if (!idempotencyKey) {
    return Response.json({ ok: false, error: "Invalid idempotency_key" }, { status: 400 });
  }
  let acquired = false;

  try {
    requireLiveRefreshRuntimeConfig(dry);
    if (!dry) {
      const claim = await claimLivePublication(
        {
          runId: id,
          idempotencyKey,
          job,
          acquiredAt: startedAt.toISOString(),
          now: startedAt.getTime(),
        },
        opts.publicationStore,
      );
      if (claim.status === "committed") {
        return Response.json({
          ok: true,
          status: "already-published",
          runId: claim.pointer.run_id,
          idempotency_key: idempotencyKey,
          generation: claim.pointer.generation,
          published_at: claim.pointer.published_at,
        });
      }
      if (claim.status === "attached") {
        return Response.json(
          {
            ok: true,
            status: "attached",
            runId: claim.lease.run_id,
            idempotency_key: idempotencyKey,
            active_until: claim.lease.expires_at,
            generation: claim.generation,
          },
          { status: 202 },
        );
      }
      if (claim.status === "rejected") {
        return Response.json(
          {
            ok: false,
            status: "rejected",
            runId: claim.lease.run_id,
            idempotency_key: idempotencyKey,
            active_until: claim.lease.expires_at,
            generation: claim.generation,
          },
          { status: 409 },
        );
      }
      acquired = true;
    }

    const result = await (opts.refresh ?? refreshLiveViews)(job, dry, {
      now: startedAt,
      ...(!dry ? { publication: { runId: id, idempotencyKey, store: opts.publicationStore } } : {}),
    });
    const log_error = dry ? null : await safeRecordSyncRun(completedRun(id, job, dry, startedAt, result));
    return Response.json({
      ok: true,
      status: dry ? "dry-run" : "published",
      idempotency_key: idempotencyKey,
      ...result,
      log_error,
      ...(job === "weekly" ? { mode: "vercel-incremental-live-refresh" } : {}),
    });
  } catch (error) {
    if (acquired) {
      try {
        await releaseLivePublication(id, opts.publicationStore);
      } catch (releaseError) {
        console.error(`[cron-${job}] failed to release live publication lease`, {
          run_id: id,
          error: releaseError instanceof Error ? releaseError.message : "Unexpected lease release failure",
        });
      }
    }
    const run = failedRun(id, job, dry, startedAt, error);
    const log_error = dry ? null : await safeRecordSyncRun(run);
    const pipeline = `cron-${job}` as const;

    // Surface the failure: greppable log + optional webhook + health beacon (all non-throwing).
    if (!dry && !isRuntimeConfigError(error)) {
      await sendAlert({ pipeline, title: `${job} live refresh failed`, run_id: id, error: run.error });
      await recordHealth(pipeline, "failed", { run_id: id, error: run.error });
    }
    console.error(`[cron-${job}] failed`, { run_id: id, error: run.error, log_error });
    return Response.json(internalFailurePayload(id), { status: 500 });
  }
}
