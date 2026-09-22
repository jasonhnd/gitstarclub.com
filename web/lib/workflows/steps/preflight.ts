import { REPO_BUCKETS } from "@/lib/workflows/buckets";
import {
  emptyCanonicalPreflightAcc,
  emptySeriesPreflightFailures,
  mergeCanonicalPreflightAcc,
  resolveCanonicalEmptyShardPolicy,
  validateCanonicalGeneration,
  type CanonicalPreflightAcc,
} from "@/lib/workflows/canonical-validation";
import { ensureColdStartCanonicalMeta } from "@/lib/workflows/cold-start";
import { readCanonicalMeta, type CanonicalPreflightResult } from "@/lib/workflows/canonical-preflight";
import type { RefreshCursor } from "@/lib/workflows/runtime/types";

/** Canonical shard families read in one workflow preflight invocation (4 kinds × N buckets). */
export const PREFLIGHT_BUCKETS_PER_JOB = 4;

export type PreflightStepFields = {
  preflight?: CanonicalPreflightResult;
  nextPreflightOffset?: number;
  preflightAcc?: CanonicalPreflightAcc;
  bucketStart?: number;
  bucketCount?: number;
};

function throwPreflightFailures(failures: string[]): never {
  throw new Error(`canonical preflight failed (${failures.length}): ${failures.slice(0, 5).join("; ")}`);
}

/**
 * One-shot helper for the in-process refresh path. The CF/HTTP step graph calls
 * `runPreflightStep` so each Worker invocation stays inside a 4-bucket window.
 */
export async function preflightCanonical(runId: string, fencingToken?: number): Promise<CanonicalPreflightResult> {
  let cursor: RefreshCursor = fencingToken == null ? {} : { fencingToken };
  while (true) {
    const step = await runPreflightStep(runId, cursor);
    if (step.preflight) return step.preflight;
    if (step.nextPreflightOffset === undefined) {
      throw new Error("canonical preflight stopped without a result or next batch");
    }
    cursor = {
      preflightOffset: step.nextPreflightOffset,
      preflightAcc: step.preflightAcc,
      fencingToken: cursor.fencingToken,
    };
  }
}

/**
 * Read-only canonical gate for one bucket window. SHA-256 receipts stay on the
 * later `validate` step so this invocation stays under the CF 1102 budget.
 */
export async function runPreflightStep(runId: string, cursor: RefreshCursor = {}): Promise<PreflightStepFields> {
  const bucketStart = cursor.preflightOffset ?? 0;
  const bucketCount = Math.min(PREFLIGHT_BUCKETS_PER_JOB, REPO_BUCKETS - bucketStart);
  if (bucketCount <= 0) {
    throw new Error(`canonical preflight offset ${bucketStart} is outside ${REPO_BUCKETS} buckets`);
  }
  const buckets = Array.from({ length: bucketCount }, (_, index) => bucketStart + index);
  if (bucketStart === 0) {
    if (cursor.fencingToken != null) {
      await ensureColdStartCanonicalMeta({ runId, fencingToken: cursor.fencingToken });
    }
    await readCanonicalMeta(runId, "workflow");
  }
  const bust = `${runId}-workflow-preflight`;
  const emptyShardPolicy = resolveCanonicalEmptyShardPolicy();
  const batch = await validateCanonicalGeneration(bust, {
    scope: "full",
    buckets,
    checksum: false,
    finalize: false,
    emptyShardPolicy,
  });
  if (batch.failures.length > 0) throwPreflightFailures(batch.failures);

  const acc = mergeCanonicalPreflightAcc(
    { ...emptyCanonicalPreflightAcc(), ...cursor.preflightAcc },
    batch.acc,
  );
  const nextOffset = bucketStart + bucketCount;
  if (batch.placeholders.length > 0) {
    console.log("[workflow-refresh] preview preflight empty-shard policy", {
      policy: emptyShardPolicy,
      run_id: runId,
      bucket_start: bucketStart,
      placeholders: batch.placeholders,
      placeholder_count: batch.placeholders.length,
    });
  }
  console.log("[workflow-refresh] preflight batch", {
    run_id: runId,
    bucket_start: bucketStart,
    bucket_count: bucketCount,
    next_offset: nextOffset < REPO_BUCKETS ? nextOffset : null,
    validated_shards: acc.validatedShards,
    placeholder_shards: acc.placeholderShards,
  });
  if (nextOffset < REPO_BUCKETS) {
    return {
      nextPreflightOffset: nextOffset,
      preflightAcc: acc,
      bucketStart,
      bucketCount,
    };
  }

  const familyFailures = emptySeriesPreflightFailures(acc, emptyShardPolicy);
  if (familyFailures.length > 0) throwPreflightFailures(familyFailures);

  return {
    preflight: await readCanonicalMeta(runId, "workflow"),
    preflightAcc: acc,
    bucketStart,
    bucketCount,
  };
}
