import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { createView, putView } from "@/lib/data/write";
import {
  PublishedWhitelist,
  ReposLookup,
  UnpublishedWhitelistPointer,
  ViewsPointer,
  WhitelistSearchProgress,
  WhitelistSnapshot,
  type UnpublishedWhitelistPointer as UnpublishedWhitelistPointerType,
  type WhitelistSearchProgress as WhitelistSearchProgressType,
  type WhitelistSnapshot as WhitelistSnapshotType,
} from "@/lib/contracts";
import { githubRepositorySearch, searchWhitelist, searchWhitelistHop, type WhitelistSearchHopResult } from "@/lib/github";
import {
  getMinTrackedStars,
  getWhitelistSearchHopBudgetMs,
  isWhitelistSearchSharded,
} from "@/lib/runtime-config";
import { putOwnedView } from "@/lib/workflows/owned-write";
import {
  blobWorkflowLeaseStore,
  renewWorkflowLease,
  type WorkflowLeaseStore,
  type WorkflowOwnership,
} from "@/lib/workflows/lease";
import type { RefreshCursor, RefreshStepResult } from "@/lib/workflows/runtime/types";

export interface WhitelistResult {
  count: number;
  added: number;
  dropped: number;
}

export type WhitelistStepFields = WhitelistResult & {
  nextWhitelistSearchSeq?: number;
  whitelistSearchSeq?: number;
  whitelistSearchRequests?: number;
  whitelistSearchQueued?: number;
};

export type WhitelistDeps = {
  readSnapshot(runId: string): Promise<WhitelistSnapshotType | null>;
  readPublishedRunId(): Promise<string | null>;
  readLegacyIds(): Promise<number[] | null>;
  readBootstrapIds(): Promise<number[]>;
  search(): ReturnType<typeof searchWhitelist>;
  searchHop(progress: WhitelistSearchProgressType | null): Promise<WhitelistSearchHopResult>;
  readProgress(runId: string): Promise<WhitelistSearchProgressType | null>;
  writeProgress(owner: WorkflowOwnership, progress: WhitelistSearchProgressType): Promise<void>;
  createSnapshot(runId: string, snapshot: WhitelistSnapshotType): Promise<boolean>;
  ensureOwnership(owner: WorkflowOwnership): Promise<void>;
  now(): string;
  searchSharded(): boolean;
  readUnpublishedPointer(): Promise<UnpublishedWhitelistPointerType | null>;
  writeUnpublishedPointer(pointer: UnpublishedWhitelistPointerType): Promise<void>;
  readMinStars(): number;
};

export function whitelistSearchProgressPath(runId: string): string {
  return `ops/workflows/${runId}/whitelist-search.json`;
}

export const UNPUBLISHED_WHITELIST_PATH = "ops/workflows/latest-unpublished-whitelist.json";

export function whitelistStepCheckpointName(cursor: RefreshCursor): string {
  return `whitelist-${cursor.whitelistSearchSeq ?? 0}`;
}

export function hasNextWhitelistSearch(result: RefreshStepResult): boolean {
  return typeof result.nextWhitelistSearchSeq === "number";
}

const defaultDeps: WhitelistDeps = {
  readSnapshot: (runId) =>
    readAuthoritativeView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot),
  readPublishedRunId: async () => {
    const pointer = await readAuthoritativeView("views/latest.json", ViewsPointer);
    return pointer?.run_id ?? null;
  },
  readLegacyIds: async () => {
    const pointer = await readAuthoritativeView("canonical/v2/whitelist/latest.json", PublishedWhitelist);
    return pointer?.ids ?? null;
  },
  readBootstrapIds: async () => {
    const lookup = await readRequiredView("lookup/repos.json", ReposLookup, { base: true });
    return Object.entries(lookup)
      .filter(([, entry]) => entry.active !== false)
      .map(([id]) => Number(id));
  },
  search: searchWhitelist,
  searchHop: (progress) =>
    searchWhitelistHop({
      minStars: getMinTrackedStars(),
      search: githubRepositorySearch(),
      progress,
      budgetMs: getWhitelistSearchHopBudgetMs(),
    }),
  readProgress: (runId) =>
    readAuthoritativeView(whitelistSearchProgressPath(runId), WhitelistSearchProgress),
  writeProgress: (owner, progress) => putOwnedView(owner, whitelistSearchProgressPath(owner.runId), progress),
  createSnapshot: (runId, snapshot) => createView(`canonical/v2/whitelist/${runId}.json`, snapshot),
  ensureOwnership: (owner) => renewWorkflowLease(owner.runId, owner.fencingToken).then(() => undefined),
  now: () => new Date().toISOString(),
  searchSharded: () => isWhitelistSearchSharded(),
  readUnpublishedPointer: () =>
    readAuthoritativeView(UNPUBLISHED_WHITELIST_PATH, UnpublishedWhitelistPointer),
  writeUnpublishedPointer: (pointer) => putView(UNPUBLISHED_WHITELIST_PATH, pointer),
  readMinStars: () => getMinTrackedStars(),
};

function resultOf(snapshot: WhitelistSnapshotType): WhitelistResult {
  return {
    count: snapshot.count,
    added: snapshot.diff.added.length,
    dropped: snapshot.diff.dropped.length,
  };
}

/**
 * Resolve the baseline through the live publish pointer. A failed run has no
 * way to alter this pointer, so its discovery snapshot cannot become the next
 * run's baseline. The legacy pointer/bootstrap branches are migration-only.
 */
async function publishedIds(deps: WhitelistDeps): Promise<number[]> {
  const publishedRunId = await deps.readPublishedRunId();
  if (publishedRunId) {
    const snapshot = await deps.readSnapshot(publishedRunId);
    if (!snapshot) {
      throw new Error(`published whitelist snapshot for run ${publishedRunId} is missing`);
    }
    return snapshot.entries.map((entry) => entry.id);
  }
  const legacy = await deps.readLegacyIds();
  return legacy ?? deps.readBootstrapIds();
}

async function persistSnapshot(
  runId: string,
  owner: WorkflowOwnership,
  deps: WhitelistDeps,
  entries: WhitelistSnapshotType["entries"],
  prevIds: number[],
  generatedAt = deps.now(),
): Promise<WhitelistResult> {
  const ids = entries.map((entry) => entry.id);
  const idSet = new Set(ids);
  const prevSet = new Set(prevIds);

  const snapshot = WhitelistSnapshot.parse({
    run_id: runId,
    generated_at: generatedAt,
    count: entries.length,
    entries,
    diff: {
      added: ids.filter((id) => !prevSet.has(id)),
      dropped: prevIds.filter((id) => !idSet.has(id)),
    },
  });

  await deps.ensureOwnership(owner);
  const created = await deps.createSnapshot(runId, snapshot);
  const persisted = created ? snapshot : await deps.readSnapshot(runId);
  if (!persisted) throw new Error(`whitelist snapshot ${runId} conflicted but cannot be read`);
  await deps.writeUnpublishedPointer({
    run_id: persisted.run_id,
    count: persisted.count,
    recorded_at: deps.now(),
  });
  return resultOf(persisted);
}

async function reusableUnpublishedEntries(
  runId: string,
  deps: WhitelistDeps,
): Promise<{ entries: WhitelistSnapshotType["entries"]; generatedAt: string } | null> {
  const pointer = await deps.readUnpublishedPointer();
  if (!pointer || pointer.run_id === runId) return null;
  const publishedRunId = await deps.readPublishedRunId();
  if (publishedRunId === pointer.run_id) return null;
  const snapshot = await deps.readSnapshot(pointer.run_id);
  if (!snapshot || snapshot.entries.length === 0) return null;
  const progress = await deps.readProgress(pointer.run_id);
  if (progress && progress.minStars !== deps.readMinStars()) return null;
  return { entries: snapshot.entries, generatedAt: snapshot.generated_at };
}

/** After a failed run, remember its unpublished snapshot so the next start can skip Search. */
export async function rememberFailedUnpublishedWhitelist(
  store: WorkflowLeaseStore | undefined = blobWorkflowLeaseStore,
  deps: Pick<WhitelistDeps, "readSnapshot" | "writeUnpublishedPointer" | "now"> = defaultDeps,
): Promise<UnpublishedWhitelistPointerType | null> {
  const current = await store.read();
  const lease = current.lease;
  if (!lease || lease.status !== "failed") return null;
  const snapshot = await deps.readSnapshot(lease.run_id);
  if (!snapshot || snapshot.entries.length === 0) return null;
  const pointer = UnpublishedWhitelistPointer.parse({
    run_id: snapshot.run_id,
    count: snapshot.count,
    recorded_at: deps.now(),
  });
  await deps.writeUnpublishedPointer(pointer);
  return pointer;
}

export async function refreshWhitelist(
  runId: string,
  fencingToken: number,
): Promise<WhitelistResult> {
  return refreshWhitelistWithDeps(runId, fencingToken, defaultDeps);
}

export async function runWhitelistStep(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor = {},
): Promise<WhitelistStepFields> {
  return runWhitelistStepWithDeps(runId, fencingToken, cursor, defaultDeps);
}

export async function refreshWhitelistWithDeps(
  runId: string,
  fencingToken: number,
  deps: WhitelistDeps,
): Promise<WhitelistResult> {
  let cursor: RefreshCursor = {};
  while (true) {
    const step = await runWhitelistStepWithDeps(runId, fencingToken, cursor, deps);
    if (step.nextWhitelistSearchSeq === undefined) {
      return { count: step.count, added: step.added, dropped: step.dropped };
    }
    cursor = { whitelistSearchSeq: step.nextWhitelistSearchSeq };
  }
}

export async function runWhitelistStepWithDeps(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor,
  deps: WhitelistDeps,
): Promise<WhitelistStepFields> {
  // A run snapshot is immutable. Explicit step retries therefore reuse exactly
  // the original entries and diff even when GitHub Search has changed.
  const existing = await deps.readSnapshot(runId);
  if (existing) return resultOf(existing);

  // Prove the fence before GitHub Search. Search can run several minutes on
  // CF; a late-only renew then hits a CDN-stale ETag / overlapping Queue retry
  // and used to fail closed as "lost ownership while renewing".
  const owner = { runId, fencingToken };
  await deps.ensureOwnership(owner);

  // Resolve the published baseline before contacting GitHub. A broken commit
  // point must fail closed instead of spending a Search request and then
  // silently comparing against a migration fallback.
  const prevIds = await publishedIds(deps);
  const reused = await reusableUnpublishedEntries(runId, deps);
  if (reused) {
    return persistSnapshot(runId, owner, deps, reused.entries, prevIds, reused.generatedAt);
  }

  if (!deps.searchSharded()) {
    const entries = await deps.search();
    return persistSnapshot(runId, owner, deps, entries, prevIds);
  }

  const seq = cursor.whitelistSearchSeq ?? 0;
  const progress = await deps.readProgress(runId);
  const hop = await deps.searchHop(progress);
  if (!hop.done) {
    await deps.ensureOwnership(owner);
    await deps.writeProgress(owner, hop.progress);
    return {
      count: hop.entries.length,
      added: 0,
      dropped: 0,
      nextWhitelistSearchSeq: seq + 1,
      whitelistSearchSeq: seq,
      whitelistSearchRequests: hop.requests,
      whitelistSearchQueued: hop.progress.queue.length,
    };
  }

  return {
    ...await persistSnapshot(runId, owner, deps, hop.entries, prevIds),
    whitelistSearchSeq: seq,
    whitelistSearchRequests: hop.requests,
    whitelistSearchQueued: 0,
  };
}
