import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import {
  fetchRepositoryMetadata,
  isTransientGithubError,
  METADATA_GRAPHQL_BATCH,
  type RepoMetadata,
} from "@/lib/github";
import {
  MetadataBucketProgress,
  ReposLookup,
  ReposShard,
  WhitelistSnapshot,
  type MetadataBucketProgress as MetadataBucketProgressType,
  type ReposShardEntry,
  type WhitelistEntry,
} from "@/lib/contracts";
import { capSafeText } from "@/lib/contracts/common";
import { repoBucket } from "../buckets";
import { putOwnedView } from "@/lib/workflows/owned-write";
import type { WorkflowOwnership } from "@/lib/workflows/lease";

function capDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  return capSafeText(value);
}

export function whitelistDiscoveryDate(snapshot: WhitelistSnapshot): string {
  return snapshot.generated_at.slice(0, 10);
}

export const MAX_METADATA_TRANSIENT_ATTEMPTS = 6;
export const METADATA_BATCH_PAUSE_MS = 2000;

export function metadataProgressPath(runId: string, bucket: number): string {
  return `ops/workflows/${runId}/metadata-${bucket}.json`;
}

export function metadataTransientRetryDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(attempts - 1, 0), 30_000);
}

export function hasNextMetadataRetry(result: { retryMetadata?: boolean }): boolean {
  return result.retryMetadata === true;
}

function metadataFromProgress(progress: MetadataBucketProgressType | null): Map<number, RepoMetadata> {
  const out = new Map<number, RepoMetadata>();
  if (!progress) return out;
  for (const [id, row] of Object.entries(progress.fetched)) {
    out.set(Number(id), row);
  }
  return out;
}

function progressRecord(fetched: ReadonlyMap<number, RepoMetadata>): Record<string, RepoMetadata> {
  const record: Record<string, RepoMetadata> = {};
  for (const [id, row] of fetched) record[String(id)] = row;
  return record;
}

// Workflow step: build canonical/v2/repos/<bucket>.json for ONE bucket. Search
// determines current membership; GraphQL metadata is required for every active
// repository and is the sole authority for current_stars. Bootstrap-frozen /
// M5-managed fields (milestones, tracked_since, anchoring factor d) are
// preserved. Repositories that leave the whitelist remain as inactive history.
// See docs/VERCEL-DATA-OPERATIONS.md §4 metadata step / §6.

export interface MetadataBucketResult {
  bucket: number;
  repos: number;
  historical: number;
  from_github: number;
  retryMetadata?: boolean;
  error?: string;
}

export interface BuildMetadataShardInput {
  entries: WhitelistEntry[];
  previous: Record<string, ReposShardEntry>;
  lookup: ReposLookup;
  github: ReadonlyMap<number, RepoMetadata>;
  newcomers: ReadonlySet<number>;
  trackedSince: string;
  fetchedAt: string;
}

export type MetadataDeps = {
  readWhitelist(runId: string): Promise<WhitelistSnapshot>;
  readLookup(runId: string): Promise<ReposLookup>;
  readPrevShard(runId: string, bucket: number): Promise<Record<string, ReposShardEntry>>;
  readProgress(runId: string, bucket: number): Promise<MetadataBucketProgressType | null>;
  writeProgress(owner: WorkflowOwnership, progress: MetadataBucketProgressType): Promise<void>;
  writeShard(owner: WorkflowOwnership, bucket: number, shard: Record<string, ReposShardEntry>): Promise<void>;
  fetchBatch(nodeIds: string[]): Promise<Map<number, RepoMetadata>>;
  now(): string;
  sleep(ms: number): Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const defaultDeps: MetadataDeps = {
  readWhitelist: (runId) => readRequiredView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId }),
  readLookup: (runId) => readRequiredView("lookup/repos.json", ReposLookup, { base: true, bust: runId }),
  readPrevShard: (runId, bucket) => readRequiredView(`canonical/v2/repos/${bucket}.json`, ReposShard, { bust: runId }),
  readProgress: (runId, bucket) =>
    readAuthoritativeView(metadataProgressPath(runId, bucket), MetadataBucketProgress, { bust: runId }),
  writeProgress: (owner, progress) => putOwnedView(owner, metadataProgressPath(owner.runId, progress.bucket), progress),
  writeShard: (owner, bucket, shard) => putOwnedView(owner, `canonical/v2/repos/${bucket}.json`, shard),
  fetchBatch: (nodeIds) => fetchRepositoryMetadata(nodeIds),
  now: () => new Date().toISOString(),
  sleep: defaultSleep,
};

/** Pure lifecycle transition used by the workflow and its contract tests. */
export function buildMetadataShard(input: BuildMetadataShardInput): Record<string, ReposShardEntry> {
  const missing = input.entries.filter((entry) => !input.github.has(entry.id));
  if (missing.length > 0) {
    throw new Error(
      `GraphQL metadata missing for ${missing.length} active repository(s): ${missing.slice(0, 5).map((entry) => entry.full_name).join(", ")}`,
    );
  }

  // Retention is explicit: every previous row starts historical and only the
  // current Search snapshot can reactivate it below.
  const shard: Record<string, ReposShardEntry> = {};
  for (const [id, previous] of Object.entries(input.previous)) {
    shard[id] = {
      ...previous,
      active: false,
      // Materialize the field even for legacy rows so every managed output
      // carries the same provenance contract through canonical and read views.
      tracked_since: previous.tracked_since ?? null,
    };
  }

  for (const entry of input.entries) {
    const previous = input.previous[String(entry.id)];
    const lookup = input.lookup[String(entry.id)];
    const github = input.github.get(entry.id)!;
    shard[String(entry.id)] = {
      id: entry.id,
      node_id: entry.node_id,
      owner: entry.owner, // Search identity is rename-aware membership data
      name: entry.name,
      full_name: entry.full_name,
      current_stars: github.current_stars,
      active: true,
      owner_type: github.owner_type ?? lookup?.owner_type ?? previous?.owner_type ?? "User",
      description: capDescription(github.description ?? previous?.description ?? null),
      language: github.language ?? lookup?.language ?? previous?.language ?? null,
      languages: github.languages ?? previous?.languages ?? [],
      topics: github.topics ?? previous?.topics ?? [],
      created_at: github.created_at ?? previous?.created_at,
      is_archived: github.is_archived ?? previous?.is_archived ?? false,
      crossed_10k: previous?.crossed_10k ?? null,
      crossed_50k: previous?.crossed_50k ?? null,
      crossed_100k: previous?.crossed_100k ?? null,
      // Re-entry keeps the original admission date. A first-time newcomer is
      // pinned to the immutable whitelist snapshot date across retries.
      tracked_since:
        previous?.tracked_since ??
        lookup?.tracked_since ??
        (input.newcomers.has(entry.id) ? input.trackedSince : null),
      d: previous?.d,
      fetched_at: input.fetchedAt,
    };
  }

  return ReposShard.parse(shard);
}

export async function refreshMetadataBucket(runId: string, bucket: number, fencingToken: number): Promise<MetadataBucketResult> {
  return refreshMetadataBucketWithDeps(runId, bucket, fencingToken, defaultDeps);
}

export async function refreshMetadataBucketWithDeps(
  runId: string,
  bucket: number,
  fencingToken: number,
  deps: MetadataDeps,
): Promise<MetadataBucketResult> {
  const owner = { runId, fencingToken };
  const wl = await deps.readWhitelist(runId);
  const entries = wl.entries.filter((e) => repoBucket(e.id) === bucket);
  const lookup = await deps.readLookup(runId);
  const prevShard = await deps.readPrevShard(runId, bucket);
  const newcomers = new Set(wl.diff.added);
  // Pin newcomer provenance to the immutable discovery snapshot. A step
  // retry on a later day must not rewrite tracked_since.
  const trackedSince = whitelistDiscoveryDate(wl);
  const fetchedAt = deps.now();
  const prior = await deps.readProgress(runId, bucket);
  const gh = metadataFromProgress(prior);

  if ((prior?.transient_attempts ?? 0) > 0) {
    await deps.sleep(metadataTransientRetryDelayMs(prior!.transient_attempts));
  }

  const pending = entries.filter((entry) => !gh.has(entry.id));
  try {
    for (let i = 0; i < pending.length; i += METADATA_GRAPHQL_BATCH) {
      const batch = pending.slice(i, i + METADATA_GRAPHQL_BATCH);
      const fetched = batch.length ? await deps.fetchBatch(batch.map((entry) => entry.node_id)) : new Map<number, RepoMetadata>();
      for (const [id, row] of fetched) gh.set(id, row);
      await deps.writeProgress(owner, MetadataBucketProgress.parse({
        v: 1,
        bucket,
        fetched: progressRecord(gh),
        transient_attempts: 0,
        last_error: null,
      }));
      if (i + METADATA_GRAPHQL_BATCH < pending.length) await deps.sleep(METADATA_BATCH_PAUSE_MS);
    }
  } catch (error) {
    if (!isTransientGithubError(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const attempts = (prior?.transient_attempts ?? 0) + 1;
    await deps.writeProgress(owner, MetadataBucketProgress.parse({
      v: 1,
      bucket,
      fetched: progressRecord(gh),
      transient_attempts: attempts,
      last_error: capSafeText(message),
    }));
    if (attempts >= MAX_METADATA_TRANSIENT_ATTEMPTS) throw error;
    return {
      bucket,
      repos: entries.length,
      historical: 0,
      from_github: gh.size,
      retryMetadata: true,
      error: message,
    };
  }

  const shard = buildMetadataShard({
    entries,
    previous: prevShard,
    lookup,
    github: gh,
    newcomers,
    trackedSince,
    fetchedAt,
  });
  await deps.writeShard(owner, bucket, shard);
  return {
    bucket,
    repos: entries.length,
    historical: Object.values(shard).filter((repo) => repo.active === false).length,
    from_github: entries.length,
  };
}
