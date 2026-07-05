import { putView } from "@/lib/data/write";

// Minimal, dependency-free observability for the data pipelines (Vercel-first).
//
// Two surfaces, both best-effort and non-throwing:
//   1. sendAlert() — always emits a greppable "[ALERT]" structured log (shows up in
//      Vercel function logs) and, IF process.env.ALERT_WEBHOOK_URL is set, POSTs a
//      short JSON payload to it. A no-op (log only) when the env var is unset.
//   2. recordHealth() — writes ops/workflows/health.json so the last run status/time
//      of each pipeline is queryable from Blob alongside the other ops artifacts.
//
// Alerting must NEVER break the pipeline: every export swallows its own errors.

const WEBHOOK_TIMEOUT_MS = 5000;
const HEALTH_PATH = "ops/workflows/health.json";

/** Which automated pipeline produced this signal (used for grep + dashboards). */
export type AlertPipeline = "workflow-refresh" | "cron-daily" | "cron-weekly";
export type HealthStatus = "ok" | "failed" | "attached" | "rejected";

export type AlertSummary = {
  pipeline: AlertPipeline;
  /** Human-readable one-liner, e.g. "managed refresh failed". */
  title: string;
  /** Durable run identifier (workflow run_id or sync-run id), when known. */
  run_id?: string;
  /** Step / job that failed, when known. */
  step?: string;
  /** Error message (already narrowed to a string by the caller). */
  error?: string;
};

/**
 * Emit a failure alert. Always logs a greppable "[ALERT]" line; additionally POSTs
 * to ALERT_WEBHOOK_URL when that env var is set. Never throws.
 */
export async function sendAlert(summary: AlertSummary): Promise<void> {
  // (a) Structured, greppable log — surfaces in Vercel function logs even with no webhook.
  console.error(`[ALERT] ${summary.pipeline} failed`, {
    run_id: summary.run_id ?? null,
    step: summary.step ?? null,
    error: summary.error ?? null,
  });

  // (b) Optional env-gated webhook. No-op (and no error) when ALERT_WEBHOOK_URL is unset.
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `[ALERT] ${summary.pipeline}: ${summary.title}`,
          pipeline: summary.pipeline,
          run_id: summary.run_id ?? null,
          step: summary.step ?? null,
          error: summary.error ?? null,
          at: new Date().toISOString(),
        }),
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    // Alerting failures must not propagate into the pipeline; just note it.
    console.error("[ALERT] webhook delivery failed", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Update ops/workflows/health.json with the latest status of one pipeline. Best-effort:
 * a Blob write failure here never propagates (the run's own checkpoint is the source of truth).
 */
export async function recordHealth(
  pipeline: AlertPipeline,
  status: HealthStatus,
  detail: { run_id?: string; error?: string; trigger_period?: string; active_run_id?: string; event?: string } = {},
): Promise<void> {
  try {
    await putView(HEALTH_PATH, {
      pipeline,
      status,
      run_id: detail.run_id ?? null,
      active_run_id: detail.active_run_id ?? null,
      trigger_period: detail.trigger_period ?? null,
      event: detail.event ?? null,
      error: detail.error ?? null,
      at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[ALERT] health write failed", err instanceof Error ? err.message : String(err));
  }
}
