/** Issue #824-C. Read-only guards; the later repair CLI owns writes and exit codes.
 * No process spawning, environment reads, credentials, or default runner.
 */
import assert from "node:assert/strict";
import { assertBootstrapGeneration } from "../../pipeline/lib/bootstrap-publication.mjs";

export type CfRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export type PublishTarget = "pre" | "production";
export type PublishTargetOptions = {
  target: string;
  bucket: string;
  generation: string;
  confirmProduction?: string;
};
export type ResolvedPublishTarget = { target: PublishTarget; bucket: string; generation: string };

const IDENTITY_KEY = "_meta/bucket-identity.json";
function bucketForTarget(target: string): string {
  assert(target === "pre" || target === "production", "--target must be pre or production");
  return target === "pre" ? "gitstarclub-data-pre" : "gitstarclub-data-prod";
}

/** All refusals throw: callers must exit nonzero and never continue to writes. */
export async function resolvePublishTarget(options: PublishTargetOptions, runner: CfRunner): Promise<ResolvedPublishTarget> {
  // Capture values before awaiting the runner so caller mutation cannot change approval.
  const { target, bucket, generation, confirmProduction } = options;
  const expectedBucket = bucketForTarget(target);
  assert(bucket === expectedBucket, `--target ${target} requires bucket ${expectedBucket}`);
  assertBootstrapGeneration(generation);
  if (target === "production") {
    const confirmation = `publish ${generation} to ${expectedBucket}`;
    assert(confirmProduction === confirmation, `Production requires exact --confirm-production "${confirmation}"`);
  } else {
    assert(confirmProduction === undefined, "--confirm-production is only valid with --target production");
  }

  let result: Awaited<ReturnType<CfRunner>>;
  try {
    // cf 1.0.0-beta.18: --text returns the object's body, not a metadata envelope.
    result = await runner(["r2", "objects", "get", IDENTITY_KEY, "--bucket-name", bucket, "--text"]);
  } catch {
    throw new Error(`Cannot read ${bucket}/${IDENTITY_KEY}; publication refused`);
  }
  assert(result.code === 0, `Cannot read ${bucket}/${IDENTITY_KEY} (cf exit ${result.code}); publication refused`);
  let marker: unknown;
  try { marker = JSON.parse(result.stdout); }
  catch { throw new Error(`Invalid JSON in ${bucket}/${IDENTITY_KEY}; publication refused`); }
  assert(marker !== null && typeof marker === "object" && !Array.isArray(marker), `Invalid identity marker: ${bucket}/${IDENTITY_KEY}`);
  const identity = marker as Record<string, unknown>;
  assert(identity.bucket === bucket && identity.deploy_env === target,
    `Bucket identity mismatch: ${bucket}/${IDENTITY_KEY} must have bucket=${bucket} and deploy_env=${target}`);
  return { target: target as PublishTarget, bucket, generation };
}

/** Integration contract: print this exact line before any upload, lease, or pointer
 * write. The later repair-publish.ts CLI must implement --rollback under the same
 * guards and writer lease; never replace this with a raw pointer upload.
 */
export function formatRollbackCommand(target: PublishTarget, recoveryGenerationId: string): string {
  const bucket = bucketForTarget(target);
  assertBootstrapGeneration(recoveryGenerationId);
  const command = `bun --no-env-file web/scripts/repair-publish.ts --target ${target} --bucket ${bucket} --rollback ${recoveryGenerationId}`;
  return target === "production"
    ? `${command} --confirm-production "publish ${recoveryGenerationId} to ${bucket}"`
    : command;
}
