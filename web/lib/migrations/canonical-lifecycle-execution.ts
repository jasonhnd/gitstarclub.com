import { ReposShard, type ReposShard as ReposShardType } from "@/lib/contracts";
import {
  CanonicalLifecycleMigrationReceipt,
  sha256Json,
  type CanonicalLifecycleMigrationBundle,
  type CanonicalLifecycleMigrationPlan,
} from "@/lib/migrations/canonical-lifecycle";
import type { WorkflowOwnership } from "@/lib/workflows/lease";

export interface CanonicalLifecycleValidationResult {
  complete: boolean;
  failures: string[];
}

export interface CanonicalLifecycleExecutionDeps {
  claim(args: {
    runId: string;
    idempotencyKey: string;
    trigger: string;
  }): Promise<WorkflowOwnership>;
  release(owner: WorkflowOwnership, status: "published" | "failed"): Promise<boolean>;
  assertSource(plan: CanonicalLifecycleMigrationPlan): Promise<void>;
  createExact(
    owner: WorkflowOwnership,
    path: string,
    value: unknown,
    sha256: string,
  ): Promise<void>;
  readRepoShard(bucket: number): Promise<ReposShardType>;
  writeRepoShard(
    owner: WorkflowOwnership,
    bucket: number,
    value: ReposShardType,
  ): Promise<void>;
  waitForShardReadConsistency?(delayMs: number): Promise<void>;
  validateFull(): Promise<CanonicalLifecycleValidationResult>;
}

export type CanonicalLifecycleShardState = "before" | "after";

export function canonicalLifecycleReceiptPrefix(planSha256: string): string {
  return `ops/migrations/canonical-lifecycle/${planSha256}`;
}

export function canonicalLifecycleReceiptPath(planSha256: string): string {
  return `${canonicalLifecycleReceiptPrefix(planSha256)}/plan.json`;
}

export function canonicalLifecycleShardReceiptPath(
  planSha256: string,
  state: CanonicalLifecycleShardState,
  bucket: number,
): string {
  return `${canonicalLifecycleReceiptPrefix(planSha256)}/${state}/repos/${bucket}.json`;
}

export function classifyCanonicalLifecycleShard(
  currentSha256: string,
  beforeSha256: string,
  afterSha256: string,
): CanonicalLifecycleShardState {
  if (currentSha256 === afterSha256) return "after";
  if (currentSha256 === beforeSha256) return "before";
  throw new Error(
    `canonical shard drift: current ${currentSha256} matches neither before ${beforeSha256} nor after ${afterSha256}`,
  );
}

const SHARD_READ_VERIFICATION_ATTEMPTS = 8;
const SHARD_READ_VERIFICATION_BASE_DELAY_MS = 250;
const SHARD_READ_VERIFICATION_MAX_DELAY_MS = 2_000;

async function verifyCanonicalLifecycleShardWrite(
  deps: CanonicalLifecycleExecutionDeps,
  bucket: number,
  expectedSha256: string,
  operation: "write" | "rollback",
): Promise<void> {
  let observedSha256 = "";
  for (let attempt = 1; attempt <= SHARD_READ_VERIFICATION_ATTEMPTS; attempt++) {
    const written = ReposShard.parse(await deps.readRepoShard(bucket));
    observedSha256 = await sha256Json(written);
    if (observedSha256 === expectedSha256) return;
    if (attempt === SHARD_READ_VERIFICATION_ATTEMPTS) break;

    const delayMs = Math.min(
      SHARD_READ_VERIFICATION_BASE_DELAY_MS * 2 ** (attempt - 1),
      SHARD_READ_VERIFICATION_MAX_DELAY_MS,
    );
    if (deps.waitForShardReadConsistency) {
      await deps.waitForShardReadConsistency(delayMs);
    } else {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(
    `canonical shard ${bucket} ${operation} verification failed: ${observedSha256}`,
  );
}

async function verifyBundle(bundle: CanonicalLifecycleMigrationBundle): Promise<void> {
  const planSha256 = await sha256Json(bundle.plan);
  if (planSha256 !== bundle.planSha256) {
    throw new Error(
      `migration plan SHA-256 mismatch: expected ${bundle.planSha256}, calculated ${planSha256}`,
    );
  }
  if (
    bundle.before.length !== bundle.plan.buckets.length ||
    bundle.after.length !== bundle.plan.buckets.length
  ) {
    throw new Error("migration bundle does not contain every planned repository shard");
  }
  for (const bucketPlan of bundle.plan.buckets) {
    const before = bundle.before.find((entry) => entry.bucket === bucketPlan.bucket);
    const after = bundle.after.find((entry) => entry.bucket === bucketPlan.bucket);
    if (!before || !after) {
      throw new Error(`migration bundle is missing bucket ${bucketPlan.bucket}`);
    }
    const beforeSha256 = await sha256Json(ReposShard.parse(before.value));
    const afterSha256 = await sha256Json(ReposShard.parse(after.value));
    if (
      before.sha256 !== bucketPlan.before_sha256 ||
      beforeSha256 !== bucketPlan.before_sha256
    ) {
      throw new Error(`migration before-state checksum mismatch for bucket ${bucketPlan.bucket}`);
    }
    if (
      after.sha256 !== bucketPlan.after_sha256 ||
      afterSha256 !== bucketPlan.after_sha256
    ) {
      throw new Error(`migration after-state checksum mismatch for bucket ${bucketPlan.bucket}`);
    }
  }
}

async function releaseAfterFailure(
  deps: CanonicalLifecycleExecutionDeps,
  owner: WorkflowOwnership,
  original: unknown,
): Promise<never> {
  const originalMessage = original instanceof Error ? original.message : String(original);
  let released: boolean;
  try {
    released = await deps.release(owner, "failed");
  } catch (releaseError) {
    const releaseMessage =
      releaseError instanceof Error ? releaseError.message : String(releaseError);
    throw new AggregateError(
      [original, releaseError],
      `canonical lifecycle migration failed: ${originalMessage}; failed lease release threw: ${releaseMessage}`,
    );
  }
  if (!released) {
    throw new AggregateError(
      [original, new Error(`migration lost lease ${owner.fencingToken} before failed release`)],
      `canonical lifecycle migration failed: ${originalMessage}; could not release its lease`,
    );
  }
  throw original;
}

export interface CanonicalLifecycleExecutionResult {
  plan_sha256: string;
  applied_buckets: number;
  already_applied_buckets: number;
}

export async function executeCanonicalLifecycleMigration(
  bundle: CanonicalLifecycleMigrationBundle,
  confirmation: string,
  deps: CanonicalLifecycleExecutionDeps,
): Promise<CanonicalLifecycleExecutionResult> {
  await verifyBundle(bundle);
  if (confirmation !== bundle.planSha256) {
    throw new Error(`--confirm must exactly equal ${bundle.planSha256}`);
  }

  const runId = `canonical-lifecycle-${bundle.planSha256.slice(0, 24)}`;
  const owner = await deps.claim({
    runId,
    idempotencyKey: `canonical-lifecycle:${bundle.planSha256}`,
    trigger: "canonical-lifecycle-migration-cli",
  });

  let appliedBuckets = 0;
  let alreadyAppliedBuckets = 0;
  try {
    await deps.assertSource(bundle.plan);

    for (const bucketPlan of bundle.plan.buckets) {
      const before = bundle.before.find((entry) => entry.bucket === bucketPlan.bucket)!;
      const after = bundle.after.find((entry) => entry.bucket === bucketPlan.bucket)!;
      await deps.createExact(
        owner,
        canonicalLifecycleShardReceiptPath(bundle.planSha256, "before", bucketPlan.bucket),
        before.value,
        bucketPlan.before_sha256,
      );
      await deps.createExact(
        owner,
        canonicalLifecycleShardReceiptPath(bundle.planSha256, "after", bucketPlan.bucket),
        after.value,
        bucketPlan.after_sha256,
      );
    }

    const receipt = CanonicalLifecycleMigrationReceipt.parse({
      schema_ver: 1,
      operation: "canonical-lifecycle-provenance",
      plan_sha256: bundle.planSha256,
      plan: bundle.plan,
    });
    await deps.createExact(
      owner,
      canonicalLifecycleReceiptPath(bundle.planSha256),
      receipt,
      await sha256Json(receipt),
    );

    for (const bucketPlan of bundle.plan.buckets) {
      const current = ReposShard.parse(await deps.readRepoShard(bucketPlan.bucket));
      const state = classifyCanonicalLifecycleShard(
        await sha256Json(current),
        bucketPlan.before_sha256,
        bucketPlan.after_sha256,
      );
      if (state === "after") {
        alreadyAppliedBuckets++;
        continue;
      }
      const after = bundle.after.find((entry) => entry.bucket === bucketPlan.bucket)!;
      await deps.writeRepoShard(owner, bucketPlan.bucket, after.value);
      await verifyCanonicalLifecycleShardWrite(
        deps,
        bucketPlan.bucket,
        bucketPlan.after_sha256,
        "write",
      );
      appliedBuckets++;
    }

    await deps.assertSource(bundle.plan);
    const validation = await deps.validateFull();
    if (!validation.complete) {
      throw new Error(
        `canonical validation failed after migration: ${validation.failures.slice(0, 5).join("; ")}`,
      );
    }
  } catch (error) {
    return releaseAfterFailure(deps, owner, error);
  }

  if (!(await deps.release(owner, "published"))) {
    throw new Error(`migration lost lease ${owner.fencingToken} before successful release`);
  }
  return {
    plan_sha256: bundle.planSha256,
    applied_buckets: appliedBuckets,
    already_applied_buckets: alreadyAppliedBuckets,
  };
}

export interface CanonicalLifecycleRollbackResult {
  plan_sha256: string;
  rolled_back_buckets: number;
  already_rolled_back_buckets: number;
}

export async function rollbackCanonicalLifecycleMigration(
  bundle: CanonicalLifecycleMigrationBundle,
  confirmation: string,
  deps: CanonicalLifecycleExecutionDeps,
): Promise<CanonicalLifecycleRollbackResult> {
  await verifyBundle(bundle);
  if (confirmation !== bundle.planSha256) {
    throw new Error(`--confirm must exactly equal ${bundle.planSha256}`);
  }

  const runId = `canonical-lifecycle-rollback-${bundle.planSha256.slice(0, 24)}`;
  const owner = await deps.claim({
    runId,
    idempotencyKey: `canonical-lifecycle-rollback:${bundle.planSha256}`,
    trigger: "canonical-lifecycle-migration-cli",
  });

  let rolledBackBuckets = 0;
  let alreadyRolledBackBuckets = 0;
  try {
    await deps.assertSource(bundle.plan);
    for (const bucketPlan of bundle.plan.buckets) {
      if (bucketPlan.before_sha256 === bucketPlan.after_sha256) {
        alreadyRolledBackBuckets++;
        continue;
      }
      const current = ReposShard.parse(await deps.readRepoShard(bucketPlan.bucket));
      const state = classifyCanonicalLifecycleShard(
        await sha256Json(current),
        bucketPlan.before_sha256,
        bucketPlan.after_sha256,
      );
      if (state === "before") {
        alreadyRolledBackBuckets++;
        continue;
      }
      const before = bundle.before.find((entry) => entry.bucket === bucketPlan.bucket)!;
      await deps.writeRepoShard(owner, bucketPlan.bucket, before.value);
      await verifyCanonicalLifecycleShardWrite(
        deps,
        bucketPlan.bucket,
        bucketPlan.before_sha256,
        "rollback",
      );
      rolledBackBuckets++;
    }
    await deps.assertSource(bundle.plan);
  } catch (error) {
    return releaseAfterFailure(deps, owner, error);
  }

  if (!(await deps.release(owner, "published"))) {
    throw new Error(`rollback lost lease ${owner.fencingToken} before successful release`);
  }
  return {
    plan_sha256: bundle.planSha256,
    rolled_back_buckets: rolledBackBuckets,
    already_rolled_back_buckets: alreadyRolledBackBuckets,
  };
}
