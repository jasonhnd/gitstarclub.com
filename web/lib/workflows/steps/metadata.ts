import { getReposLookup } from "@/lib/data";
import { readView } from "@/lib/data/source";
import { batchMetadata } from "@/lib/github";
import { ReposShard, WhitelistSnapshot, type ReposShardEntry } from "@/lib/contracts";
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

// Workflow step: build canonical/v2/repos/<bucket>.json for ONE bucket by SEEDING
// from data already pulled at bootstrap — owner_type/language from
// lookup/repos.json, fresh current_stars + node_id + (rename-aware) full_name
// from the run whitelist. GitHub GraphQL is hit ONLY for genuine newcomers
// (absent from both the previous shard and the bootstrap lookup), so the
// recurring refresh does not re-pull all ~5,261 repos and never trips GitHub's
// secondary rate limit. Bootstrap-frozen / M5-managed fields (milestones,
// tracked_since, anchoring factor d) are preserved from the previous shard; repos that
// fell out of the whitelist stay (chronicle never deletes).
// See docs/VERCEL-DATA-OPERATIONS.md §4 metadata step / §6.

export interface MetadataBucketResult {
  bucket: number;
  repos: number;
  from_github: number;
}

export async function refreshMetadataBucket(runId: string, bucket: number, fencingToken: number): Promise<MetadataBucketResult> {
  "use step";

  const wl = await readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId });
  if (!wl) throw new Error(`whitelist for run ${runId} not found`);

  const entries = wl.entries.filter((e) => repoBucket(e.id) === bucket);
  if (entries.length === 0) return { bucket, repos: 0, from_github: 0 };

  const lookup = (await getReposLookup()) ?? {};
  const prevShard = (await readView(`canonical/v2/repos/${bucket}.json`, ReposShard, { bust: runId })) ?? {};
  const newcomers = new Set(wl.diff.added);
  // Pin newcomer provenance to the immutable discovery snapshot. A Workflow
  // retry on a later day must not rewrite tracked_since.
  const trackedSince = whitelistDiscoveryDate(wl);
  const fetchedAt = new Date().toISOString();

  // Only genuine newcomers and repos missing the GitHub language breakdown need
  // a GitHub metadata fetch. After the first language-backfill run, existing
  // repos carry `languages` in the canonical shard and are not re-pulled weekly.
  const needGitHub = entries.filter((e) => {
    const prev = prevShard[String(e.id)];
    return (!prev && !lookup[String(e.id)]) || !Array.isArray(prev?.languages);
  });
  const gh = needGitHub.length ? await batchMetadata(needGitHub.map((e) => e.node_id)) : new Map();

  const shard: Record<string, ReposShardEntry> = { ...prevShard }; // keep dropped/historical repos
  for (const e of entries) {
    const prev = prevShard[String(e.id)];
    const lk = lookup[String(e.id)];
    const g = gh.get(e.id);
    shard[String(e.id)] = {
      id: e.id,
      node_id: e.node_id,
      owner: e.owner, // whitelist: fresh + rename-aware
      name: e.name,
      full_name: e.full_name,
      current_stars: e.stars, // whitelist: fresh from Search
      owner_type: g?.owner_type ?? lk?.owner_type ?? prev?.owner_type ?? "User",
      description: capDescription(g?.description ?? prev?.description ?? null),
      language: g?.language ?? lk?.language ?? prev?.language ?? null,
      languages: g?.languages ?? prev?.languages ?? [],
      topics: g?.topics ?? prev?.topics ?? [],
      created_at: g?.created_at ?? prev?.created_at,
      is_archived: g?.is_archived ?? prev?.is_archived ?? false,
      // bootstrap-frozen — preserved from prev shard (seed from entity/repo in a later phase):
      crossed_10k: prev?.crossed_10k ?? null,
      crossed_50k: prev?.crossed_50k ?? null,
      crossed_100k: prev?.crossed_100k ?? null,
      tracked_since: prev?.tracked_since ?? (newcomers.has(e.id) ? trackedSince : null),
      d: prev?.d,
      fetched_at: fetchedAt,
    };
  }

  ReposShard.parse(shard);
  await putOwnedView({ runId, fencingToken }, `canonical/v2/repos/${bucket}.json`, shard);
  return { bucket, repos: entries.length, from_github: needGitHub.length };
}
