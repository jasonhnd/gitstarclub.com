import { z } from "zod";
import { getReposLookup } from "@/lib/data";
import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { searchWhitelist } from "@/lib/github";
import { WhitelistSnapshot } from "@/lib/contracts";

// Workflow step: refresh the ≥10k whitelist via GitHub Search, diff against the
// previously-tracked id set, and write canonical/v2/whitelist/<run_id>.json + a
// latest pointer. Ported from pipeline/backfill/01-whitelist. See
// docs/VERCEL-DATA-OPERATIONS.md §4 whitelist step.

const WhitelistLatest = z.object({ run_id: z.string(), ids: z.array(z.number().int()) });

export interface WhitelistResult {
  count: number;
  added: number;
  dropped: number;
}

/** Previously-tracked ids: the v2 whitelist pointer if present, else the bootstrap
 *  lookup baseline (so existing repos are NOT treated as newcomers on the first v2 run). */
async function previousIds(runId: string): Promise<number[]> {
  const pointer = await readView("canonical/v2/whitelist/latest.json", WhitelistLatest, { bust: runId });
  if (pointer) return pointer.ids;
  const lookup = await getReposLookup();
  return lookup ? Object.keys(lookup).map(Number) : [];
}

export async function refreshWhitelist(runId: string): Promise<WhitelistResult> {
  "use step";

  const entries = await searchWhitelist();
  const ids = entries.map((e) => e.id);
  const idSet = new Set(ids);

  const prevIds = await previousIds(runId);
  const prevSet = new Set(prevIds);
  const added = ids.filter((id) => !prevSet.has(id)); // newcomers
  const dropped = prevIds.filter((id) => !idSet.has(id)); // fell out of ≥10k

  const snapshot = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    count: entries.length,
    entries,
    diff: { added, dropped },
  };
  WhitelistSnapshot.parse(snapshot); // self-validate before publish

  await putView(`canonical/v2/whitelist/${runId}.json`, snapshot);
  await putView("canonical/v2/whitelist/latest.json", { run_id: runId, ids });

  return { count: entries.length, added: added.length, dropped: dropped.length };
}
