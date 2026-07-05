import { recordHealth, sendAlert, type AlertSummary, type HealthStatus } from "@/lib/observability/alert";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";
import { claimWorkflowLease, releaseWorkflowLease, type WorkflowLeaseStore } from "@/lib/workflows/lease";

export type RefreshWorkflowStarter = (runId: string) => Promise<void>;
type HealthRecorder = typeof recordHealth;
type AlertSender = (summary: AlertSummary) => Promise<void>;

type StartRouteOptions = {
  now?: Date;
  leaseStore?: WorkflowLeaseStore;
  recordHealth?: HealthRecorder;
  sendAlert?: AlertSender;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(week)}`;
}

export function refreshRunId(now = new Date()): string {
  return `refresh-${now.toISOString().replaceAll(/[:.]/g, "-")}`;
}

export function refreshIdempotencyKey(req: Request, now = new Date()): string {
  const url = new URL(req.url);
  return (
    req.headers.get("idempotency-key") ??
    req.headers.get("x-idempotency-key") ??
    url.searchParams.get("idempotency_key") ??
    url.searchParams.get("idempotencyKey") ??
    `workflow-refresh:${isoWeekId(now)}`
  );
}

function refreshTrigger(req: Request): string {
  const url = new URL(req.url);
  return url.searchParams.get("trigger") ?? req.headers.get("x-vercel-cron") ?? "manual-or-cron";
}

async function recordStartHealth(
  recorder: HealthRecorder,
  status: HealthStatus,
  detail: { run_id: string; idempotency_key: string; error?: string },
): Promise<void> {
  await recorder("workflow-refresh", status, detail);
}

function requireRefreshWorkflowRuntimeConfig(): void {
  requireBlobBaseUrl();
  requireBlobWriteToken();
  requireGithubToken();
}

export async function startRefreshWorkflowRoute(
  req: Request,
  startWorkflow: RefreshWorkflowStarter,
  opts: StartRouteOptions = {},
): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;

  const now = opts.now ?? new Date();
  const acquiredAt = now.toISOString();
  const runId = refreshRunId(now);
  const idempotencyKey = refreshIdempotencyKey(req, now);
  const recorder = opts.recordHealth ?? recordHealth;
  const alerter = opts.sendAlert ?? sendAlert;

  try {
    requireRefreshWorkflowRuntimeConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[workflow-refresh] invalid runtime config", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }

  let claim;
  try {
    claim = await claimWorkflowLease(
      {
        runId,
        acquiredAt,
        idempotencyKey,
        trigger: refreshTrigger(req),
        now: now.getTime(),
      },
      opts.leaseStore,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await alerter({ pipeline: "workflow-refresh", title: "failed to acquire managed refresh lease", run_id: runId, step: "start", error: message });
    console.error("[workflow-refresh] failed to acquire lease", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }

  if (claim.status === "attached") {
    await recordStartHealth(recorder, "attached", { run_id: claim.lease.run_id, idempotency_key: idempotencyKey });
    return Response.json({ ok: true, runId: claim.lease.run_id, idempotencyKey, status: "attached" });
  }

  if (claim.status === "rejected") {
    const error = `Refresh already running until ${claim.lease.expires_at}`;
    await recordStartHealth(recorder, "rejected", { run_id: claim.lease.run_id, idempotency_key: idempotencyKey, error });
    return Response.json(
      {
        ok: false,
        runId: claim.lease.run_id,
        idempotencyKey,
        status: "rejected",
        error,
        activeUntil: claim.lease.expires_at,
      },
      { status: 409 },
    );
  }

  try {
    await startWorkflow(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseWorkflowLease(runId, "failed", opts.leaseStore);
    await alerter({ pipeline: "workflow-refresh", title: "failed to enqueue managed refresh", run_id: runId, step: "start", error: message });
    console.error("[workflow-refresh] failed to enqueue", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }

  return Response.json({ ok: true, runId, idempotencyKey, status: "started" });
}

