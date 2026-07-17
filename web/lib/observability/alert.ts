import type { AlertPipeline } from "@/lib/contracts";

const WEBHOOK_TIMEOUT_MS = 5_000;
const WEBHOOK_MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 250] as const;

export type { AlertPipeline } from "@/lib/contracts";

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

export type AlertDeliveryResult = {
  status: "disabled" | "delivered" | "failed";
  attempts: number;
  status_code: number | null;
  error: string | null;
};

export type AlertFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type AlertDeliveryOptions = {
  fetch?: AlertFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
  now?: Date;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeDeliveryError(error: unknown, timedOut: boolean): string {
  if (timedOut || (error instanceof Error && error.name === "AbortError")) return "timeout";
  if (!(error instanceof Error)) return "network failure";
  const safeMessage = error.message
    .replaceAll(/https?:\/\/\S+/gi, "[redacted-url]")
    .replaceAll(/(token|key|secret)=[^\s&]+/gi, "$1=[redacted]")
    .slice(0, 300);
  return safeMessage ? `${error.name}: ${safeMessage}` : error.name || "network failure";
}

function failedDelivery(
  summary: AlertSummary,
  attempts: number,
  statusCode: number | null,
  error: string,
): AlertDeliveryResult {
  const result: AlertDeliveryResult = {
    status: "failed",
    attempts,
    status_code: statusCode,
    error,
  };
  console.error("[ALERT] webhook delivery failed", {
    pipeline: summary.pipeline,
    run_id: summary.run_id ?? null,
    ...result,
  });
  return result;
}

/**
 * Emit a failure alert. The structured log is unconditional. An optional
 * webhook is bounded by timeout and retries, checks HTTP status, returns an
 * explicit delivery result, and never throws into the data pipeline.
 */
export async function sendAlert(
  summary: AlertSummary,
  options: AlertDeliveryOptions = {},
): Promise<AlertDeliveryResult> {
  console.error(`[ALERT] ${summary.pipeline} failed`, {
    run_id: summary.run_id ?? null,
    step: summary.step ?? null,
    error: summary.error ?? null,
  });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) {
    return { status: "disabled", attempts: 0, status_code: null, error: null };
  }

  const fetcher = options.fetch ?? globalThis.fetch;
  const sleeper = options.sleep ?? delay;
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
  const requestedAttempts = options.maxAttempts ?? WEBHOOK_MAX_ATTEMPTS;
  const maxAttempts = Number.isFinite(requestedAttempts)
    ? Math.min(5, Math.max(1, Math.floor(requestedAttempts)))
    : WEBHOOK_MAX_ATTEMPTS;
  const at = (options.now ?? new Date()).toISOString();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `[ALERT] ${summary.pipeline}: ${summary.title}`,
          pipeline: summary.pipeline,
          run_id: summary.run_id ?? null,
          step: summary.step ?? null,
          error: summary.error ?? null,
          at,
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.ok) {
        return {
          status: "delivered",
          attempts: attempt,
          status_code: response.status,
          error: null,
        };
      }

      const error = `HTTP ${response.status}`;
      if (!retryableStatus(response.status) || attempt === maxAttempts) {
        return failedDelivery(summary, attempt, response.status, error);
      }
    } catch (error) {
      const diagnostic = safeDeliveryError(error, timedOut);
      if (attempt === maxAttempts) {
        return failedDelivery(summary, attempt, null, diagnostic);
      }
    } finally {
      clearTimeout(timer);
    }

    await sleeper(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)] ?? 250);
  }

  return failedDelivery(summary, maxAttempts, null, "delivery attempts exhausted");
}
