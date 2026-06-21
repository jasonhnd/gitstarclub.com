import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { ReposShard, RenameMap, WhitelistSnapshot, type RenameEntry } from "@/lib/contracts";
import { repoBucket } from "../buckets";

// Workflow step: detect repo renames by comparing the run whitelist's full_name
// (repo_id is stable across renames) against the previous repos shard. MUST run
// BEFORE the metadata step overwrites those shards. Writes
// ops/workflows/<run_id>/renames.json (web layer 308s old URLs -> new).
// See docs/VERCEL-DATA-OPERATIONS.md §4 rename detection step.

export interface RenameResult {
  renames: number;
}

export async function detectRenames(runId: string): Promise<RenameResult> {
  "use step";

  const wl = await readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId });
  if (!wl) throw new Error(`whitelist for run ${runId} not found`);

  const byBucket = new Map<number, typeof wl.entries>();
  for (const e of wl.entries) {
    const b = repoBucket(e.id);
    const arr = byBucket.get(b);
    if (arr) arr.push(e);
    else byBucket.set(b, [e]);
  }

  const renames: RenameEntry[] = [];
  for (const [b, entries] of byBucket) {
    const prev = await readView(`canonical/v2/repos/${b}.json`, ReposShard, { bust: runId });
    if (!prev) continue; // no previous shard → first run, nothing renamed
    for (const e of entries) {
      const p = prev[String(e.id)];
      if (p && p.full_name !== e.full_name) {
        renames.push({ id: e.id, old_full_name: p.full_name, new_full_name: e.full_name });
      }
    }
  }

  const map = { run_id: runId, generated_at: new Date().toISOString(), renames };
  RenameMap.parse(map);
  await putView(`ops/workflows/${runId}/renames.json`, map);
  return { renames: renames.length };
}
