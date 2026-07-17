import { getReposLookup } from "@/lib/data";
import { readView } from "@/lib/data/source";
import { createView } from "@/lib/data/write";
import {
  PublishedWhitelist,
  ViewsPointer,
  WhitelistSnapshot,
  type WhitelistSnapshot as WhitelistSnapshotType,
} from "@/lib/contracts";
import { searchWhitelist } from "@/lib/github";
import { renewWorkflowLease, type WorkflowOwnership } from "@/lib/workflows/lease";

export interface WhitelistResult {
  count: number;
  added: number;
  dropped: number;
}

export type WhitelistDeps = {
  readSnapshot(runId: string): Promise<WhitelistSnapshotType | null>;
  readPublishedRunId(): Promise<string | null>;
  readLegacyIds(): Promise<number[] | null>;
  readBootstrapIds(): Promise<number[]>;
  search(): ReturnType<typeof searchWhitelist>;
  createSnapshot(runId: string, snapshot: WhitelistSnapshotType): Promise<boolean>;
  ensureOwnership(owner: WorkflowOwnership): Promise<void>;
  now(): string;
};

const defaultDeps: WhitelistDeps = {
  readSnapshot: (runId) => readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot),
  readPublishedRunId: async () => {
    const pointer = await readView("views/latest.json", ViewsPointer);
    return pointer?.run_id ?? null;
  },
  readLegacyIds: async () => {
    const pointer = await readView("canonical/v2/whitelist/latest.json", PublishedWhitelist);
    return pointer?.ids ?? null;
  },
  readBootstrapIds: async () => {
    const lookup = await getReposLookup();
    return lookup
      ? Object.entries(lookup)
          .filter(([, entry]) => entry.active !== false)
          .map(([id]) => Number(id))
      : [];
  },
  search: searchWhitelist,
  createSnapshot: (runId, snapshot) => createView(`canonical/v2/whitelist/${runId}.json`, snapshot),
  ensureOwnership: (owner) => renewWorkflowLease(owner.runId, owner.fencingToken).then(() => undefined),
  now: () => new Date().toISOString(),
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
    if (snapshot) return snapshot.entries.map((entry) => entry.id);
  }
  const legacy = await deps.readLegacyIds();
  return legacy ?? deps.readBootstrapIds();
}

export async function refreshWhitelist(
  runId: string,
  fencingToken: number,
): Promise<WhitelistResult> {
  "use step";

  return refreshWhitelistWithDeps(runId, fencingToken, defaultDeps);
}

export async function refreshWhitelistWithDeps(
  runId: string,
  fencingToken: number,
  deps: WhitelistDeps,
): Promise<WhitelistResult> {

  // A run snapshot is immutable. Workflow SDK retries therefore reuse exactly
  // the original entries and diff even when GitHub Search has changed.
  const existing = await deps.readSnapshot(runId);
  if (existing) return resultOf(existing);

  const entries = await deps.search();
  const ids = entries.map((entry) => entry.id);
  const idSet = new Set(ids);
  const prevIds = await publishedIds(deps);
  const prevSet = new Set(prevIds);

  const snapshot = WhitelistSnapshot.parse({
    run_id: runId,
    generated_at: deps.now(),
    count: entries.length,
    entries,
    diff: {
      added: ids.filter((id) => !prevSet.has(id)),
      dropped: prevIds.filter((id) => !idSet.has(id)),
    },
  });

  const owner = { runId, fencingToken };
  await deps.ensureOwnership(owner);
  const created = await deps.createSnapshot(runId, snapshot);
  if (created) return resultOf(snapshot);

  const raced = await deps.readSnapshot(runId);
  if (!raced) throw new Error(`whitelist snapshot ${runId} conflicted but cannot be read`);
  return resultOf(raced);
}
