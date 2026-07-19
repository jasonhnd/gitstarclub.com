import { getReposLookup } from "@/lib/data";
import { readView } from "@/lib/data/source";
import { batchMetadata, type RepoMetadata } from "@/lib/github";
import { ReposShard, WhitelistSnapshot, type ReposLookup, type ReposShardEntry, type WhitelistEntry } from "@/lib/contracts";
import { capSafeText } from "@/lib/contracts/common";
import { repoBucket } from "../buckets";
import { putOwnedView } from "@/lib/workflows/owned-write";

function capDescription(value: string | null | undefined): string | null {
  if (value == null) return null;
  return capSafeText(value);
}

export function whitelistDiscoveryDate(snapshot: WhitelistSnapshot): string {
  return snapshot.generated_at.slice(0, 10);
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
  "use step";

  const wl = await readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId });
  if (!wl) throw new Error(`whitelist for run ${runId} not found`);

  const entries = wl.entries.filter((e) => repoBucket(e.id) === bucket);
  const lookup = (await getReposLookup()) ?? {};
  const prevShard = (await readView(`canonical/v2/repos/${bucket}.json`, ReposShard, { bust: runId })) ?? {};
  const newcomers = new Set(wl.diff.added);
  // Pin newcomer provenance to the immutable discovery snapshot. A Workflow
  // retry on a later day must not rewrite tracked_since.
  const trackedSince = whitelistDiscoveryDate(wl);
  const fetchedAt = new Date().toISOString();

  const gh = entries.length ? await batchMetadata(entries.map((e) => e.node_id)) : new Map<number, RepoMetadata>();
  const shard = buildMetadataShard({
    entries,
    previous: prevShard,
    lookup,
    github: gh,
    newcomers,
    trackedSince,
    fetchedAt,
  });
  await putOwnedView({ runId, fencingToken }, `canonical/v2/repos/${bucket}.json`, shard);
  return {
    bucket,
    repos: entries.length,
    historical: Object.values(shard).filter((repo) => repo.active === false).length,
    from_github: entries.length,
  };
}
