import { BlobPreconditionFailedError, get, put } from "@vercel/blob";
import {
  PipelineHealth,
  capSafeText,
  type AlertPipeline,
  type HealthSignal,
  type HealthStatus,
  type PipelineHealth as PipelineHealthType,
} from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";

const MAX_CAS_ATTEMPTS = 5;

const EXPECTED_INTERVAL_SECONDS: Record<AlertPipeline, number> = {
  "cron-daily": 36 * 60 * 60,
  "cron-weekly": 8 * 24 * 60 * 60,
  "workflow-refresh": 8 * 24 * 60 * 60,
};

export type HealthDetail = {
  run_id?: string;
  error?: string;
  idempotency_key?: string;
  correlation_id?: string;
};

export type HealthSnapshot = {
  health: PipelineHealthType | null;
  etag: string | null;
};

export type HealthStore = {
  read(pipeline: AlertPipeline): Promise<HealthSnapshot>;
  create(pipeline: AlertPipeline, health: PipelineHealthType): Promise<boolean>;
  compareAndSet(
    pipeline: AlertPipeline,
    etag: string,
    health: PipelineHealthType,
  ): Promise<boolean>;
};

export type RecordHealthOptions = {
  store?: HealthStore;
  now?: Date;
};

export function healthPath(pipeline: AlertPipeline): string {
  return `ops/workflows/health/${pipeline}.json`;
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function isBlobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  if (!(error instanceof Error)) return false;
  return /already exists|overwrite|precondition|conflict|409|412/i.test(
    `${error.name} ${error.message}`,
  );
}

export class BlobHealthStore implements HealthStore {
  async read(pipeline: AlertPipeline): Promise<HealthSnapshot> {
    const path = healthPath(pipeline);
    const result = await get(path, { access: "public", token: requireBlobWriteToken() });
    if (!result) return { health: null, etag: null };
    if (result.statusCode !== 200 || !result.stream) {
      throw new Error(`health read ${path} -> ${result.statusCode}`);
    }
    return {
      health: PipelineHealth.parse(JSON.parse(await streamText(result.stream))),
      etag: result.blob.etag,
    };
  }

  async create(pipeline: AlertPipeline, health: PipelineHealthType): Promise<boolean> {
    PipelineHealth.parse(health);
    try {
      await put(healthPath(pipeline), JSON.stringify(health), {
        access: "public",
        token: requireBlobWriteToken(),
        allowOverwrite: false,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }

  async compareAndSet(
    pipeline: AlertPipeline,
    etag: string,
    health: PipelineHealthType,
  ): Promise<boolean> {
    PipelineHealth.parse(health);
    try {
      await put(healthPath(pipeline), JSON.stringify(health), {
        access: "public",
        token: requireBlobWriteToken(),
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 60,
        ifMatch: etag,
      });
      return true;
    } catch (error) {
      if (isBlobConflict(error)) return false;
      throw error;
    }
  }
}

export const blobHealthStore = new BlobHealthStore();

function newerSignal(current: HealthSignal | null, next: HealthSignal): HealthSignal {
  return !current || next.at >= current.at ? next : current;
}

function signal(
  pipeline: AlertPipeline,
  at: string,
  detail: HealthDetail,
): HealthSignal {
  const nullableSafeText = (value: string | undefined): string | null =>
    value === undefined ? null : capSafeText(value);
  return {
    at,
    correlation_id: capSafeText(
      detail.correlation_id ??
      detail.run_id ??
      detail.idempotency_key ??
      `${pipeline}:${at}`,
    ),
    run_id: nullableSafeText(detail.run_id),
    idempotency_key: nullableSafeText(detail.idempotency_key),
    error: nullableSafeText(detail.error),
  };
}

export function mergePipelineHealth(
  current: PipelineHealthType | null,
  pipeline: AlertPipeline,
  status: HealthStatus,
  detail: HealthDetail,
  now: Date,
): PipelineHealthType {
  const nextSignal = signal(pipeline, now.toISOString(), detail);
  const latest = current && current.at > nextSignal.at
    ? {
        status: current.status,
        at: current.at,
        correlation_id: current.correlation_id,
        run_id: current.run_id,
        idempotency_key: current.idempotency_key,
        error: current.error,
      }
    : { status, ...nextSignal };

  const lastSuccess = status === "ok"
    ? newerSignal(current?.last_success ?? null, nextSignal)
    : current?.last_success ?? null;
  const lastFailure = status === "failed"
    ? newerSignal(current?.last_failure ?? null, nextSignal)
    : current?.last_failure ?? null;
  const expectedWithinSeconds = EXPECTED_INTERVAL_SECONDS[pipeline];
  const staleAfter = lastSuccess
    ? new Date(Date.parse(lastSuccess.at) + expectedWithinSeconds * 1000).toISOString()
    : null;

  return PipelineHealth.parse({
    schema_version: 2,
    pipeline,
    ...latest,
    last_success: lastSuccess,
    last_failure: lastFailure,
    freshness: {
      last_success_at: lastSuccess?.at ?? null,
      expected_within_seconds: expectedWithinSeconds,
      stale_after: staleAfter,
    },
  });
}

/**
 * Persist one pipeline's health with ETag compare-and-set. Separate paths stop
 * unrelated pipelines from overwriting each other; the merge preserves both
 * the last success and last failure under retries and out-of-order completion.
 */
export async function recordHealth(
  pipeline: AlertPipeline,
  status: HealthStatus,
  detail: HealthDetail = {},
  options: RecordHealthOptions = {},
): Promise<void> {
  const store = options.store ?? blobHealthStore;
  const now = options.now ?? new Date();

  try {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const current = await store.read(pipeline);
      const next = mergePipelineHealth(current.health, pipeline, status, detail, now);

      if (!current.health) {
        if (await store.create(pipeline, next)) return;
        continue;
      }
      if (!current.etag) throw new Error(`${pipeline} health object is missing an ETag`);
      if (await store.compareAndSet(pipeline, current.etag, next)) return;
    }
    throw new Error(`${pipeline} health CAS exhausted after ${MAX_CAS_ATTEMPTS} attempts`);
  } catch (error) {
    console.error(
      "[ALERT] health write failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}
