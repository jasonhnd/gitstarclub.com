import {
  LatestSuccess,
  PublishIntent,
  PublishedWhitelist,
  ViewsPointer,
  type PublishIntent as PublishIntentType,
  type PublishedWhitelist as PublishedWhitelistType,
  type ViewsPointer as ViewsPointerType,
  type WhitelistSnapshot as WhitelistSnapshotType,
} from "@/lib/contracts";
import { SCHEMA_VER } from "@/lib/data/meta";

export type PublicationResult = {
  version: string;
  prev_version: string | null;
  published_at: string;
};

export type PublicationOwner = {
  runId: string;
  fencingToken: number;
};

export type PublicationDeps = {
  readPointer(): Promise<ViewsPointerType | null>;
  readIntent(operationId: string): Promise<PublishIntentType | null>;
  createIntent(operationId: string, intent: PublishIntentType): Promise<boolean>;
  readWhitelistSnapshot(runId: string): Promise<WhitelistSnapshotType | null>;
  writePointer(pointer: ViewsPointerType): Promise<void>;
  writeRecovery(recovery: LatestSuccess): Promise<void>;
  writeWhitelistPointer(pointer: PublishedWhitelistType): Promise<void>;
  ensureOwnership(owner: PublicationOwner): Promise<void>;
  invalidate(): Promise<void>;
  notifyIndexNow(args: { runId: string; prevVersion: string | null; publishedAt: string }): Promise<unknown>;
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
): Promise<PublishIntentType> {
  const existing = await deps.readIntent(operationId);
  if (existing) {
    const intent = validateIntent(existing, operation, operationId);
    if (intent.version !== version) throw new Error(`publish intent ${operationId} already targets ${intent.version}`);
    return intent;
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
  if (created) return intent;

  // A same-run retry won the immutable create race. Read and use exactly what
  // it persisted instead of recomputing a possibly different rollback target.
  const raced = await deps.readIntent(operationId);
  if (!raced) throw new Error(`publish intent ${operationId} conflicted but cannot be read`);
  const intentAfterRace = validateIntent(raced, operation, operationId);
  if (intentAfterRace.version !== version) {
    throw new Error(`publish intent ${operationId} already targets ${intentAfterRace.version}`);
  }
  return intentAfterRace;
}

async function applyIntent(
  owner: PublicationOwner,
  intent: PublishIntentType,
  deps: PublicationDeps,
): Promise<PublicationResult> {
  const whitelist = await deps.readWhitelistSnapshot(intent.version);
  if (!whitelist) throw new Error(`whitelist snapshot for published version ${intent.version} not found`);

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

  // Each write is deterministic and overwrite-idempotent. The live pointer is
  // the publication commit point; recovery and the compatibility whitelist
  // pointer advance only after that switch succeeds. If a later write fails,
  // the immutable intent makes the retry reproduce the same rollback metadata.
  await deps.ensureOwnership(owner);
  await deps.writePointer(pointer);
  await deps.ensureOwnership(owner);
  await deps.writeRecovery(recovery);
  await deps.ensureOwnership(owner);
  await deps.writeWhitelistPointer(publishedWhitelist);
  await deps.invalidate();
  await deps.notifyIndexNow({
    runId: intent.version,
    prevVersion: intent.prev_version,
    publishedAt: intent.published_at,
  });

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
    return applyIntent(owner, intent, deps);
  }
  const current = await deps.readPointer();
  const previousVersion = current?.version === runId ? current.prev_version : (current?.version ?? null);
  const intent = await getOrCreateIntent("publish", runId, owner, runId, previousVersion, deps);
  return applyIntent(owner, intent, deps);
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
    return applyIntent(owner, intent, deps);
  }

  const current = await deps.readPointer();
  if (!current) throw new Error("cannot roll back before the first published version");
  const target = targetVersion ?? current.prev_version;
  if (!target) throw new Error(`published version ${current.version} has no rollback target`);
  if (target === current.version) throw new Error(`published version ${current.version} already targets ${target}`);
  const intent = await getOrCreateIntent("rollback", operationId, owner, target, current.version, deps);
  return applyIntent(owner, intent, deps);
}
