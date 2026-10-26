import {
  LatestSuccess,
  PublishIntent,
  PublishedWhitelist,
  ViewsPointer,
  type ReleaseRecord,
  type PublishIntent as PublishIntentType,
  type PublishedWhitelist as PublishedWhitelistType,
  type ViewsPointer as ViewsPointerType,
  type WhitelistSnapshot as WhitelistSnapshotType,
} from "@/lib/contracts";
import { SCHEMA_VER } from "@/lib/data/meta";
import { WorkflowLeaseOwnershipError } from "@/lib/workflows/lease";

export type PublicationResult = {
  version: string;
  prev_version: string | null;
  published_at: string;
};

export type PublicationOwner = {
  runId: string;
  fencingToken: number;
};

/**
 * Steps checked against the live pointer when they fail: the invalidation
 * target check, the whitelist snapshot read, and the pointer write. Before
 * the pointer write they count as post-commit only on a replay, when an
 * earlier attempt may already have switched the pointer.
 */
export type PublicationCommitCheckStep = "invalidate" | "whitelist_snapshot" | "pointer" | "releases";

/** Steps that can fail while `views/latest.json` already serves the intent's version. */
export type PublicationPostCommitStep =
  | PublicationCommitCheckStep
  | "recovery"
  | "whitelist_pointer"
  | "indexnow"
  | "ownership";

function causeText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The live pointer already serves `version`, but a later publication step did
 * not finish. A retry inside the same step replays the immutable intent and
 * repairs the rest; once the run is marked failed, the next successful run
 * rewrites them. Not a reason to roll back or to rerun the refresh.
 */
export class PublicationPostCommitError extends Error {
  readonly version: string;
  readonly step: PublicationPostCommitStep;

  constructor(version: string, step: PublicationPostCommitStep, cause: unknown) {
    super(`version ${version} is live; post-commit ${step} failed: ${causeText(cause)}`, { cause });
    this.name = "PublicationPostCommitError";
    this.version = version;
    this.step = step;
  }
}

/**
 * The run lost its lease after the pointer switched. It is still a
 * WorkflowLeaseOwnershipError, so the runtime refuses to retry it, and it
 * carries the live version so the run ledger records a post-commit failure.
 */
export class PublicationPostCommitLeaseLostError extends WorkflowLeaseOwnershipError {
  readonly version: string;
  readonly step: PublicationPostCommitStep;

  constructor(version: string, cause: WorkflowLeaseOwnershipError, step: PublicationPostCommitStep = "ownership") {
    super(`version ${version} is live; post-commit ${step === "ownership" ? "ownership check" : step} failed: ${cause.message}`);
    this.name = "PublicationPostCommitLeaseLostError";
    this.version = version;
    this.step = step;
    this.cause = cause;
  }
}

/** A step around the pointer write failed and the live pointer could not be read to tell whether it switched. */
export class PublicationCommitUnknownError extends Error {
  readonly version: string;
  readonly step: PublicationCommitCheckStep;

  constructor(version: string, step: PublicationCommitCheckStep, cause: unknown) {
    super(`version ${version} may be live; ${step} failed and the live pointer could not be read: ${causeText(cause)}`, {
      cause,
    });
    this.name = "PublicationCommitUnknownError";
    this.version = version;
    this.step = step;
  }
}

export type PublicationDeps = {
  readPointer(): Promise<ViewsPointerType | null>;
  readIntent(operationId: string): Promise<PublishIntentType | null>;
  createIntent(operationId: string, intent: PublishIntentType): Promise<boolean>;
  readWhitelistSnapshot(runId: string): Promise<WhitelistSnapshotType | null>;
  writePointer(pointer: ViewsPointerType): Promise<void>;
  writeRecovery(recovery: LatestSuccess): Promise<void>;
  writeWhitelistPointer(pointer: PublishedWhitelistType): Promise<void>;
  ensureOwnership(owner: PublicationOwner): Promise<void>;
  /** Throws when the cache-invalidation target cannot be resolved; runs before the pointer switch. */
  checkInvalidationTarget(): void;
  invalidate(): Promise<void>;
  notifyIndexNow(args: { runId: string; prevVersion: string | null; publishedAt: string }): Promise<unknown>;
  prepareRelease(intent: PublishIntentType): Promise<ReleaseRecord>;
  appendRelease(owner: PublicationOwner, record: ReleaseRecord): Promise<void>;
  now(): string;
};

function validateIntent(
  intent: PublishIntentType,
  operation: "publish" | "rollback",
  operationId: string,
): PublishIntentType {
  if (intent.operation !== operation || intent.run_id !== operationId) {
    throw new Error(`publish intent ${operationId} does not match ${operation} operation`);
  }
  if (intent.prev_version === intent.version) {
    throw new Error(`publish intent ${operationId} points prev_version at its own version`);
  }
  return intent;
}

async function getOrCreateIntent(
  operation: "publish" | "rollback",
  operationId: string,
  owner: PublicationOwner,
  version: string,
  previousVersion: string | null,
  deps: PublicationDeps,
): Promise<{ intent: PublishIntentType; created: boolean }> {
  const existing = await deps.readIntent(operationId);
  if (existing) {
    const intent = validateIntent(existing, operation, operationId);
    if (intent.version !== version) throw new Error(`publish intent ${operationId} already targets ${intent.version}`);
    return { intent, created: false };
  }

  if (previousVersion === version) throw new Error(`refusing to publish ${version} with itself as prev_version`);
  const intent = PublishIntent.parse({
    operation,
    run_id: operationId,
    version,
    prev_version: previousVersion,
    published_at: deps.now(),
    fencing_token: owner.fencingToken,
  });
  await deps.ensureOwnership(owner);
  const created = await deps.createIntent(operationId, intent);
  if (created) return { intent, created: true };

  // A same-run retry won the immutable create race. Read and use exactly what
  // it persisted instead of recomputing a possibly different rollback target.
  const raced = await deps.readIntent(operationId);
  if (!raced) throw new Error(`publish intent ${operationId} conflicted but cannot be read`);
  const intentAfterRace = validateIntent(raced, operation, operationId);
  if (intentAfterRace.version !== version) {
    throw new Error(`publish intent ${operationId} already targets ${intentAfterRace.version}`);
  }
  return { intent: intentAfterRace, created: false };
}

type CommitState = "live" | "not_live" | "unknown";

/** `live` only when the pointer is exactly this intent's switch. */
async function commitState(intent: PublishIntentType, deps: PublicationDeps): Promise<CommitState> {
  let live: ViewsPointerType | null;
  try {
    live = await deps.readPointer();
  } catch {
    return "unknown";
  }
  const switched =
    live?.version === intent.version &&
    live.published_at === intent.published_at &&
    live.prev_version === intent.prev_version;
  return switched ? "live" : "not_live";
}

/**
 * Run a step up to and including the pointer write. When it fails, read the
 * pointer once if it may have switched: the pointer write itself (its response
 * can be lost), or any step of a replay (an earlier attempt may have switched
 * it). A freshly created intent cannot be live before its pointer write.
 */
async function beforeCommit<T>(
  intent: PublishIntentType,
  deps: PublicationDeps,
  replay: boolean,
  step: PublicationCommitCheckStep,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!replay && step !== "pointer") throw error;
    const state = await commitState(intent, deps);
    if (state === "live") throw new PublicationPostCommitError(intent.version, step, error);
    if (state === "unknown") throw new PublicationCommitUnknownError(intent.version, step, error);
    throw error;
  }
}

async function afterCommit(
  intent: PublishIntentType,
  step: PublicationPostCommitStep,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof WorkflowLeaseOwnershipError) throw new PublicationPostCommitLeaseLostError(intent.version, error, step);
    throw new PublicationPostCommitError(intent.version, step, error);
  }
}

/** Ownership check after the pointer switched: a failure here is a post-commit failure. */
async function ensureOwnershipAfterCommit(
  owner: PublicationOwner,
  intent: PublishIntentType,
  deps: PublicationDeps,
): Promise<void> {
  try {
    await deps.ensureOwnership(owner);
  } catch (error) {
    if (error instanceof WorkflowLeaseOwnershipError) {
      throw new PublicationPostCommitLeaseLostError(intent.version, error);
    }
    throw new PublicationPostCommitError(intent.version, "ownership", error);
  }
}

async function applyIntent(
  owner: PublicationOwner,
  intent: PublishIntentType,
  deps: PublicationDeps,
  replay: boolean,
): Promise<PublicationResult> {
  // Resolve the cache-invalidation target before anything can go live, so a
  // missing or cross-environment origin cannot leave a switched pointer behind.
  await beforeCommit(intent, deps, replay, "invalidate", async () => deps.checkInvalidationTarget());
  const whitelist = await beforeCommit(intent, deps, replay, "whitelist_snapshot", async () => {
    const snapshot = await deps.readWhitelistSnapshot(intent.version);
    if (!snapshot) throw new Error(`whitelist snapshot for published version ${intent.version} not found`);
    return snapshot;
  });

  const pointer = ViewsPointer.parse({
    version: intent.version,
    run_id: intent.version,
    published_at: intent.published_at,
    prev_version: intent.prev_version,
    schema_ver: SCHEMA_VER,
  });
  const recovery = LatestSuccess.parse({
    run_id: intent.version,
    version: intent.version,
    published_at: intent.published_at,
  });
  const publishedWhitelist = PublishedWhitelist.parse({
    run_id: intent.version,
    ids: whitelist.entries.map((entry) => entry.id),
  });
  const release = intent.operation === "publish"
    ? await beforeCommit(intent, deps, replay, "releases", () => deps.prepareRelease(intent))
    : null;

  // Each write is deterministic and overwrite-idempotent. The live pointer is
  // the publication commit point; recovery and the compatibility whitelist
  // pointer advance only after that switch succeeds. If a later write fails,
  // the immutable intent makes the retry reproduce the same rollback metadata.
  // Failures after the switch surface as PublicationPostCommitError so the run
  // ledger records the live version. A lease lost after the switch keeps its
  // non-retryable WorkflowLeaseOwnershipError type through
  // PublicationPostCommitLeaseLostError. The check before the switch stays a
  // plain pre-commit error.
  await deps.ensureOwnership(owner);
  await beforeCommit(intent, deps, replay, "pointer", () => deps.writePointer(pointer));
  await ensureOwnershipAfterCommit(owner, intent, deps);
  await afterCommit(intent, "recovery", () => deps.writeRecovery(recovery));
  await ensureOwnershipAfterCommit(owner, intent, deps);
  await afterCommit(intent, "whitelist_pointer", () => deps.writeWhitelistPointer(publishedWhitelist));
  await afterCommit(intent, "invalidate", () => deps.invalidate());
  await afterCommit(intent, "indexnow", () =>
    deps.notifyIndexNow({
      runId: intent.version,
      prevVersion: intent.prev_version,
      publishedAt: intent.published_at,
    }),
  );
  if (release) {
    await ensureOwnershipAfterCommit(owner, intent, deps);
    await afterCommit(intent, "releases", () => deps.appendRelease(owner, release));
  }

  return { version: intent.version, prev_version: intent.prev_version, published_at: intent.published_at };
}

export async function publishVersionWithDeps(
  runId: string,
  fencingToken: number,
  deps: PublicationDeps,
): Promise<PublicationResult> {
  const owner = { runId, fencingToken };
  const existing = await deps.readIntent(runId);
  if (existing) {
    const intent = validateIntent(existing, "publish", runId);
    if (intent.version !== runId) throw new Error(`publish intent ${runId} already targets ${intent.version}`);
    return applyIntent(owner, intent, deps, true);
  }
  const current = await deps.readPointer();
  const previousVersion = current?.version === runId ? current.prev_version : (current?.version ?? null);
  const { intent, created } = await getOrCreateIntent("publish", runId, owner, runId, previousVersion, deps);
  return applyIntent(owner, intent, deps, !created);
}

export async function rollbackVersionWithDeps(
  operationId: string,
  fencingToken: number,
  targetVersion: string | undefined,
  deps: PublicationDeps,
): Promise<PublicationResult> {
  const owner = { runId: operationId, fencingToken };
  const existing = await deps.readIntent(operationId);
  if (existing) {
    const intent = validateIntent(existing, "rollback", operationId);
    if (targetVersion && targetVersion !== intent.version) {
      throw new Error(`rollback ${operationId} already targets ${intent.version}`);
    }
    return applyIntent(owner, intent, deps, true);
  }

  const current = await deps.readPointer();
  if (!current) throw new Error("cannot roll back before the first published version");
  const target = targetVersion ?? current.prev_version;
  if (!target) throw new Error(`published version ${current.version} has no rollback target`);
  if (target === current.version) throw new Error(`published version ${current.version} already targets ${target}`);
  const { intent, created } = await getOrCreateIntent("rollback", operationId, owner, target, current.version, deps);
  return applyIntent(owner, intent, deps, !created);
}
