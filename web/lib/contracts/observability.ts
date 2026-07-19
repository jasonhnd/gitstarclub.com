import { z } from "zod";
import { NonNegativeInt, SafeText, TimestampStr } from "./common";

export const AlertPipeline = z.enum(["workflow-refresh", "cron-daily", "cron-weekly"]);
export type AlertPipeline = z.infer<typeof AlertPipeline>;

export const HealthStatus = z.enum(["ok", "failed", "attached", "rejected"]);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const HealthSignal = z.object({
  at: TimestampStr,
  correlation_id: SafeText,
  run_id: SafeText.nullable(),
  idempotency_key: SafeText.nullable(),
  error: SafeText.nullable(),
}).strict();
export type HealthSignal = z.infer<typeof HealthSignal>;

export const PipelineHealth = z.object({
  schema_version: z.literal(2),
  pipeline: AlertPipeline,
  status: HealthStatus,
  at: TimestampStr,
  correlation_id: SafeText,
  run_id: SafeText.nullable(),
  idempotency_key: SafeText.nullable(),
  error: SafeText.nullable(),
  last_success: HealthSignal.nullable(),
  last_failure: HealthSignal.nullable(),
  freshness: z.object({
    last_success_at: TimestampStr.nullable(),
    expected_within_seconds: NonNegativeInt,
    stale_after: TimestampStr.nullable(),
  }).strict(),
}).strict();
export type PipelineHealth = z.infer<typeof PipelineHealth>;
