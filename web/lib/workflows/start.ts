import { recordHealth, sendAlert, type AlertSummary, type HealthStatus } from "@/lib/observability/alert";
import { requireBlobBaseUrl, requireBlobWriteToken, requireGithubToken } from "@/lib/runtime-config";
import { internalFailurePayload, requireBearerToken } from "@/lib/security";
import { claimWorkflowLease, releaseWorkflowLease, type WorkflowLeaseStore } from "@/lib/workflows/lease";
import { readCanonicalPreflight } from "@/lib/workflows/canonical-preflight";

export type RefreshWorkflowStarter = (runId: string) => Promise<void>;
type HealthRecorder = typeof recordHealth;
type AlertSender = (summary: AlertSummary) => Promise<void>;

type StartRouteOptions = {
  now?: Date;
  leaseStore?: WorkflowLeaseStore;
  recordHealth?: HealthRecorder;
  sendAlert?: AlertSender;
  preflight?: typeof readCanonicalPreflight;
};

const SUPPORTED_START_QUERY = new Set(["idempotency_key", "idempotencyKey", "trigger"]);

function invalidStartQuery(req: Request): Response | null {
  const params = new URL(req.url).searchParams;
  if (params.has("dry")) {
    return Response.json(
      {
        ok: false,
        error: "Managed refresh does not support dry-run. Use the daily or weekly cron dry-run endpoint instead.",
      },
      { status: 400 },
    );
  }
  const unsupported = [...new Set([...params.keys()].filter((key) => !SUPPORTED_START_QUERY.has(key)))];
  if (unsupported.length > 0) {
    return Response.json(
      { ok: false, error: `Unsupported query parameter${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}` },
      { status: 400 },
    );
  }
  return null;
}

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

  // Reject ambiguous requests before runtime preflight, lease acquisition,
  // health writes, or workflow enqueue. Managed refresh has no dry-run mode.
  const invalidQuery = invalidStartQuery(req);
  if (invalidQuery) return invalidQuery;

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

  try {
    await (opts.preflight ?? readCanonicalPreflight)(runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[workflow-refresh] canonical preflight failed", { run_id: runId, error: message });
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
    let message = error instanceof Error ? error.message : String(error);
    const released = await releaseWorkflowLease(runId, "failed", opts.leaseStore, new Date().toISOString(), claim.lease.fencing_token);
    if (!released) message += `; failed to release fencing token ${claim.lease.fencing_token}`;
    await alerter({ pipeline: "workflow-refresh", title: "failed to enqueue managed refresh", run_id: runId, step: "start", error: message });
    console.error("[workflow-refresh] failed to enqueue", { run_id: runId, error: message });
    return Response.json(internalFailurePayload(runId), { status: 500 });
  }

  return Response.json({ ok: true, runId, idempotencyKey, status: "started" });
}
