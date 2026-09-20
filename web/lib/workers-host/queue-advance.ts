import { nextRefreshJob } from "../workflows/runtime/graph";
import {
  isRefreshStepJob,
  type RefreshStepJob,
  type RefreshStepResult,
} from "../workflows/runtime/types";

/** Set by the CF Queue consumer so the step isolate does not POST /enqueue. */
export const QUEUE_ADVANCE_HEADER = "x-gitstarclub-queue-advance";
export const QUEUE_ADVANCE_CONSUMER = "consumer";

export function queueAdvanceFromConsumer(headers: Headers): boolean {
  return headers.get(QUEUE_ADVANCE_HEADER)?.trim().toLowerCase() === QUEUE_ADVANCE_CONSUMER;
}

export function isRefreshStepSuccessPayload(value: unknown): value is {
  ok: true;
  result: RefreshStepResult;
} {
  if (!value || typeof value !== "object") return false;
  const payload = value as { ok?: unknown; result?: unknown };
  if (payload.ok !== true || !payload.result || typeof payload.result !== "object") return false;
  return typeof (payload.result as { name?: unknown }).name === "string";
}

/**
 * Keep the service-bound step isolate alive until the JSON body exists, then
 * compute the successor. The consumer must do this: `await fetch()` only waits
 * for headers, and Cloudflare terminates the child when the parent stops
 * awaiting. After fold that killed the public `/enqueue` hop (no recompute
 * message, no error.json). See CF-MIGRATION-P1 fold→recompute stall.
 */
export async function successorJobAfterRefreshStep(
  job: unknown,
  response: Response,
): Promise<RefreshStepJob | null> {
  if (!response.ok) {
    throw new Error(`refresh step failed: HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("refresh step returned a non-JSON body");
  }
  if (!isRefreshStepSuccessPayload(body)) {
    throw new Error("refresh step returned an unsuccessful or result-less payload");
  }
  if (!isRefreshStepJob(job)) {
    throw new Error("refresh queue job is not a valid step job after a successful response");
  }
  return nextRefreshJob(job, body.result);
}
