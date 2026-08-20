import { refreshLiveViews, type LiveRefreshJob } from "@/lib/cron/live-refresh";
import {
  claimLivePublication,
  releaseLivePublication,
  type LivePublicationStore,
} from "@/lib/cron/live-publication";
import { completedRun, failedRun, safeRecordSyncRun, syncRunId } from "@/lib/cron/sync-runs";
import { sendAlert } from "@/lib/observability/alert";
import { recordHealth } from "@/lib/observability/health";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";

function requireLiveRefreshRuntimeConfig(dry: boolean): void {
  requireBlobBaseUrl();
  requireGithubToken();
  if (!dry) requireBlobWriteToken();
}

export interface LiveRefreshRouteOptions {
  now?: Date;
  publicationStore?: LivePublicationStore;
  refresh?: typeof refreshLiveViews;
  claimPublication?: typeof claimLivePublication;
  releasePublication?: typeof releaseLivePublication;
  recordSyncRun?: typeof safeRecordSyncRun;
  recordHealth?: typeof recordHealth;
  sendAlert?: typeof sendAlert;
  requireRuntimeConfig?: typeof requireLiveRefreshRuntimeConfig;
}

function liveIdempotencyKey(url: URL, job: LiveRefreshJob, day: string): string | null {
  const provided = url.searchParams.get("idempotency_key");
  const key = provided === null ? `${job}:${day}` : provided;
  return /^[A-Za-z0-9._:-]{1,200}$/.test(key) ? key : null;
}

export async function runLiveRefreshRoute(
  req: Request,
  job: LiveRefreshJob,
  options: LiveRefreshRouteOptions = {},
): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const startedAt = options.now ?? new Date();
  const id = syncRunId(job, startedAt);
  const idempotencyKey = liveIdempotencyKey(url, job, startedAt.toISOString().slice(0, 10));
  if (!idempotencyKey) {
    return Response.json({ ok: false, error: "Invalid idempotency_key" }, { status: 400 });
  }

  const refresh = options.refresh ?? refreshLiveViews;
  const claimPublication = options.claimPublication ?? claimLivePublication;
  const releasePublication = options.releasePublication ?? releaseLivePublication;
  const recordSyncRun = options.recordSyncRun ?? safeRecordSyncRun;
  const health = options.recordHealth ?? recordHealth;
  const alert = options.sendAlert ?? sendAlert;
  let acquired = false;
  let claim: Awaited<ReturnType<typeof claimLivePublication>> | undefined;

  try {
    (options.requireRuntimeConfig ?? requireLiveRefreshRuntimeConfig)(dry);
    if (!dry) {
      claim = await claimPublication(
        {
          runId: id,
          idempotencyKey,
          job,
          acquiredAt: startedAt.toISOString(),
          now: startedAt.getTime(),
        },
        options.publicationStore,
      );
      if (claim.status === "committed") {
        await health(`cron-${job}`, "ok", {
          run_id: claim.pointer.run_id ?? undefined,
          idempotency_key: idempotencyKey,
        });
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
        await health(`cron-${job}`, "attached", {
          run_id: claim.lease.run_id,
          idempotency_key: idempotencyKey,
        });
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
        const error = `Live publication already running until ${claim.lease.expires_at}`;
        await health(`cron-${job}`, "rejected", {
          run_id: claim.lease.run_id,
          idempotency_key: idempotencyKey,
          error,
        });
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

    const result = await refresh(job, dry, {
      now: startedAt,
      ...(!dry
        ? {
            publication: {
              runId: id,
              idempotencyKey,
              store: options.publicationStore,
              claimedEtag: claim?.status === "acquired" ? claim.etag : undefined,
              claimedPreviousGeneration: claim?.status === "acquired" ? claim.previous_generation : undefined,
            },
          }
        : {}),
    });
    const log_error = dry
      ? null
      : await recordSyncRun(completedRun(id, job, dry, startedAt, result));
    if (!dry) {
      await health(`cron-${job}`, "ok", {
        run_id: id,
        idempotency_key: idempotencyKey,
      });
    }
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
        await releasePublication(id, options.publicationStore, {
          claimedEtag: claim?.status === "acquired" ? claim.etag : undefined,
        });
      } catch (releaseError) {
        console.error(`[cron-${job}] failed to release live publication lease`, {
          run_id: id,
          error:
            releaseError instanceof Error
              ? releaseError.message
              : "Unexpected lease release failure",
        });
      }
    }
    const run = failedRun(id, job, dry, startedAt, error);
    const log_error = dry ? null : await recordSyncRun(run);
    const pipeline = `cron-${job}` as const;

    if (!dry) {
      await alert({
        pipeline,
        title: `${job} live refresh failed`,
        run_id: id,
        error: run.error,
      });
      await health(pipeline, "failed", {
        run_id: id,
        idempotency_key: idempotencyKey,
        error: run.error,
      });
    }
    console.error(`[cron-${job}] failed`, { run_id: id, error: run.error, log_error });
    return Response.json(internalFailurePayload(id), { status: 500 });
  }
}
