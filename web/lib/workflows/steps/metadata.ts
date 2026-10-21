import { readColdStartLookupOrEmpty, readColdStartReposShardOrEmpty } from "@/lib/workflows/cold-start";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import {
  fetchRepositoryMetadata,
  isMetadataPage502,
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
  type MetadataSkippedRepo,
  type ReposShardEntry,
  type WhitelistEntry,
} from "@/lib/contracts";
import { capSafeText } from "@/lib/contracts/common";
import { sanitizeErrorText } from "@/lib/observability/sanitize-error";
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

export const MAX_METADATA_TRANSIENT_ATTEMPTS = 12;
export const METADATA_BATCH_PAUSE_MS = 2000;

export function metadataProgressPath(runId: string, bucket: number): string {
  return `ops/workflows/${runId}/metadata-${bucket}.json`;
}

export function metadataTransientRetryDelayMs(attempts: number): number {
  return Math.min(8_000 * 2 ** Math.max(attempts - 1, 0), 60_000);
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

/** Prefer in-run progress; otherwise borrow fetched rows from a failed run (fresh transient budget). */
export function coalesceMetadataBucketProgress(
  bucket: number,
  own: MetadataBucketProgressType | null,
  borrowed: MetadataBucketProgressType | null,
): MetadataBucketProgressType | null {
  if (own) return own;
  if (borrowed) {
    return MetadataBucketProgress.parse({
      ...borrowed,
      bucket,
      transient_attempts: 0,
      last_error: null,
    });
  }
  return null;
}

async function loadMetadataBucketProgress(
  runId: string,
  bucket: number,
  deps: MetadataDeps,
): Promise<MetadataBucketProgressType | null> {
  const own = await deps.readProgress(runId, bucket);
  const wl = await deps.readWhitelist(runId);
  const resumeRunId = wl.metadata_resume_run_id;
  if (!resumeRunId || resumeRunId === runId) return own;
  const borrowed = await deps.readProgress(resumeRunId, bucket);
  return coalesceMetadataBucketProgress(bucket, own, borrowed);
}

// Workflow step: build canonical/v2/repos/<bucket>.json for ONE bucket. Search
// determines current membership; GraphQL is the sole source of new star counts.
// Recorded skips retain old values or remain explicitly missing. Bootstrap-frozen /
// M5-managed fields (milestones, tracked_since, anchoring factor d) are
// preserved. Repositories that leave the whitelist remain as inactive history.
// See docs/VERCEL-DATA-OPERATIONS.md §4 metadata step / §6.

export interface MetadataBucketResult {
  bucket: number;
  repos: number;
  historical: number;
  from_github: number;
  skipped_count?: number;
  skipped?: MetadataSkippedRepo[];
  retryMetadata?: boolean;
  error?: string;
}

export interface BuildMetadataShardInput {
  entries: WhitelistEntry[];
  previous: Record<string, ReposShardEntry>;
  lookup: ReposLookup;
  github: ReadonlyMap<number, RepoMetadata>;
  skipped?: ReadonlySet<number>;
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
  readLookup: (runId) => readColdStartLookupOrEmpty(runId),
  readPrevShard: (runId, bucket) => readColdStartReposShardOrEmpty(runId, bucket),
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
  const missing = input.entries.filter((entry) => !input.github.has(entry.id) && !input.skipped?.has(entry.id));
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
    const github = input.github.get(entry.id);
    if (!github) {
      // A recorded skip never substitutes Search stars or an invented zero.
      // Retain the previous values and their fetched_at; a first-time missing
      // repository has no entity/lookup/rank row and uses the missing page.
      if (previous) shard[String(entry.id)] = {
        ...shard[String(entry.id)],
        current_stars: lookup?.current_stars ?? previous.current_stars,
        active: true,
      };
      continue;
    }
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
      ...(previous?.aggregate_history ? { aggregate_history: previous.aggregate_history } : {}),
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
  for (const entry of entries) {
    if (!prevShard[String(entry.id)] && !lookup[String(entry.id)]) newcomers.add(entry.id);
  }
  // Pin newcomer provenance to the immutable discovery snapshot. A step
  // retry on a later day must not rewrite tracked_since.
  const trackedSince = whitelistDiscoveryDate(wl);
  const fetchedAt = deps.now();
  const prior = await loadMetadataBucketProgress(runId, bucket, deps);
  const gh = metadataFromProgress(prior);
  const skipped = new Map((prior?.skipped ?? []).map((row) => [row.id, row]));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const row of skipped.values()) {
    const entry = byId.get(row.id);
    if (!entry || entry.node_id !== row.node_id || entry.full_name !== row.full_name) {
      throw new Error(`metadata skip does not match whitelist id ${row.id}`);
    }
    row.value_status = prevShard[String(row.id)] ? "retained" : "missing";
  }
  const pending = entries.filter((entry) => !gh.has(entry.id) && !skipped.has(entry.id));
  const pages = prior?.pending_pages?.map((ids) => ids.map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`metadata page contains non-whitelist id ${id}`);
    return entry;
  }).filter((entry) => !gh.has(entry.id) && !skipped.has(entry.id))).filter((page) => page.length > 0) ??
    Array.from({ length: Math.ceil(pending.length / METADATA_GRAPHQL_BATCH) }, (_, i) =>
      pending.slice(i * METADATA_GRAPHQL_BATCH, (i + 1) * METADATA_GRAPHQL_BATCH));
  let attempts = prior?.transient_attempts ?? 0;
  const save = (lastError: string | null = null) => deps.writeProgress(owner, MetadataBucketProgress.parse({
    v: 1,
    bucket,
    fetched: progressRecord(gh),
    skipped: [...skipped.values()],
    pending_pages: pages.map((page) => page.map((entry) => entry.id)),
    transient_attempts: attempts,
    last_error: lastError,
  }));
  const retry = (error?: string): MetadataBucketResult => ({
    bucket, repos: entries.length, historical: 0, from_github: gh.size,
    retryMetadata: true, error,
  });
  const skip = (entry: WhitelistEntry, reason: MetadataSkippedRepo["reason"]) => {
    skipped.set(entry.id, {
      id: entry.id, node_id: entry.node_id, full_name: entry.full_name, reason,
      value_status: prevShard[String(entry.id)] ? "retained" : "missing",
    });
  };

  // Completed borrowed buckets never enter the fetch loop. Publish validation
  // reads this run's audit ledger, so materialize it before writing the shard.
  if (pages.length === 0) await save();

  if (attempts > 0) {
    await deps.sleep(metadataTransientRetryDelayMs(attempts));
  }

  while (pages.length > 0) {
    const batch = pages[0];
    let fetched: Map<number, RepoMetadata>;
    try {
      fetched = await deps.fetchBatch(batch.map((entry) => entry.node_id));
    } catch (error) {
      const message = capSafeText(sanitizeErrorText(error instanceof Error ? error.message : String(error)));
      if (isMetadataPage502(error)) {
        if (batch.length > 1) {
          const mid = Math.ceil(batch.length / 2);
          pages.splice(0, 1, batch.slice(0, mid), batch.slice(mid));
        } else {
          skip(batch[0], "graphql_502");
          pages.shift();
        }
        attempts = 0;
        await save();
        // Yield after a failed page. The next invocation resumes the saved
        // halves instead of repeating an expensive parent query.
        if (pages.length > 0) return retry();
        break;
      }
      if (!isTransientGithubError(error)) throw error;
      attempts++;
      await save(message);
      if (attempts >= MAX_METADATA_TRANSIENT_ATTEMPTS) throw error;
      return retry(message);
    }
    for (const entry of batch) {
      const row = fetched.get(entry.id);
      if (row) gh.set(entry.id, row);
      else skip(entry, "not_returned");
    }
    pages.shift();
    attempts = 0;
    await save();
    if (pages.length > 0) await deps.sleep(METADATA_BATCH_PAUSE_MS);
  }

  const shard = buildMetadataShard({
    entries,
    previous: prevShard,
    lookup,
    github: gh,
    skipped: new Set(skipped.keys()),
    newcomers,
    trackedSince,
    fetchedAt,
  });
  await deps.writeShard(owner, bucket, shard);
  const skippedRepos = [...skipped.values()];
  if (skippedRepos.length > 0) {
    console.warn("[workflow-refresh] metadata skipped repositories", {
      run_id: runId, bucket, count: skippedRepos.length, repositories: skippedRepos,
    });
  }
  return {
    bucket,
    repos: Object.values(shard).filter((repo) => repo.active === true).length,
    historical: Object.values(shard).filter((repo) => repo.active === false).length,
    from_github: entries.filter((entry) => gh.has(entry.id)).length,
    skipped_count: skippedRepos.length,
    skipped: skippedRepos,
  };
}
