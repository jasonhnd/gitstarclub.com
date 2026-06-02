import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { batchMetadata } from "@/lib/github";
import { ReposShard, WhitelistSnapshot, type ReposShardEntry } from "@/lib/contracts";
import { repoBucket } from "../buckets";

// Workflow step: fetch repo metadata for ONE bucket and write
// canonical/v2/repos/<bucket>.json. One bucket = ~165 repos ≈ 2 GraphQL nodes()
// batches, so each step is short and idempotent — the workflow loops the 32
// buckets sequentially (with a sleep between) so GitHub's secondary rate limit
// is never hit. (The earlier monolithic "all repos in one step" tripped the
// 403 secondary limit, per docs/VERCEL-DATA-OPERATIONS.md §3.3 "steps must be
// short / batched".) Bootstrap-frozen / M5-managed fields (milestones,
// tracked_since, discount d) are preserved from the previous shard; repos that
// fell out of the whitelist stay (chronicle never deletes).
// Ported from pipeline/backfill/03-metadata. See VERCEL-DATA-OPERATIONS §3.4 (step 2).

export interface MetadataBucketResult {
  bucket: number;
  repos: number;
}

export async function refreshMetadataBucket(runId: string, bucket: number): Promise<MetadataBucketResult> {
  "use step";

  const wl = await readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId });
  if (!wl) throw new Error(`whitelist for run ${runId} not found`);

  const entries = wl.entries.filter((e) => repoBucket(e.id) === bucket);
  if (entries.length === 0) return { bucket, repos: 0 };

  const meta = await batchMetadata(entries.map((e) => e.node_id));
  const fetchedAt = new Date().toISOString();
  const newcomers = new Set(wl.diff.added);
  const trackedSince = fetchedAt.slice(0, 10);

  const prevShard = (await readView(`canonical/v2/repos/${bucket}.json`, ReposShard, { bust: runId })) ?? {};
  const shard: Record<string, ReposShardEntry> = { ...prevShard }; // keep dropped/historical repos
  for (const e of entries) {
    const m = meta.get(e.id);
    const prev = prevShard[String(e.id)];
    shard[String(e.id)] = {
      id: e.id,
      node_id: e.node_id,
      owner: m?.owner ?? prev?.owner ?? e.owner,
      owner_type: m?.owner_type ?? prev?.owner_type ?? "User",
      name: m?.name ?? prev?.name ?? e.name,
      full_name: m?.full_name ?? prev?.full_name ?? e.full_name,
      description: m?.description ?? prev?.description ?? null,
      language: m?.language ?? prev?.language ?? null,
      topics: m?.topics ?? prev?.topics ?? [],
      created_at: m?.created_at ?? prev?.created_at,
      current_stars: m?.current_stars ?? e.stars,
      is_archived: m?.is_archived ?? prev?.is_archived ?? false,
      // bootstrap-frozen / M5-managed — preserved, not re-derived here:
      crossed_10k: prev?.crossed_10k ?? null,
      crossed_50k: prev?.crossed_50k ?? null,
      crossed_100k: prev?.crossed_100k ?? null,
      tracked_since: prev?.tracked_since ?? (newcomers.has(e.id) ? trackedSince : null),
      d: prev?.d,
      fetched_at: fetchedAt,
    };
  }

  ReposShard.parse(shard);
  await putView(`canonical/v2/repos/${bucket}.json`, shard);
  return { bucket, repos: entries.length };
}
