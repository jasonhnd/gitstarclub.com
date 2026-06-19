import { list } from "@vercel/blob";
import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { RenameMap, ReposLookup, AliasMap } from "@/lib/contracts";
import { buildAliasMap } from "../recompute/aliases";

// Workflow step (after recompute, before validate): build views/<run_id>/lookup/aliases.json —
// old (renamed-away) full_name → current repo id — so the repo route can 308-redirect a stale
// URL (e.g. /facebook/react after the repo moved to /react/react) instead of 404ing.
//
// Source of truth is the UNION of every retained run's ops/workflows/<run>/renames.json delta:
// gc never prunes ops/, and a rename only appears in the delta of the run that first observed it
// (a later run sees whitelist == prev shard → no delta). Re-unioning all retained deltas each run
// is self-healing and captures renames that happened in earlier runs (e.g. facebook/create-react-app).
// See docs/VERCEL-DATA-OPERATIONS.md §3.4 and docs/DATA-CONTRACTS.md.

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export interface AliasResult {
  aliases: number;
  runs_scanned: number;
}

export async function buildAliases(runId: string): Promise<AliasResult> {
  "use step";
  if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN not set");

  // Current repo lookup written earlier this run (id → full_name + fields); the redirect target
  // is resolved from here, so a still-tracked id always points at its current slug.
  const lookup = await readView(`views/${runId}/lookup/repos.json`, ReposLookup, { bust: runId });
  if (!lookup) throw new Error(`lookup/repos.json for run ${runId} not found`);

  // Enumerate every run folder and union its rename delta (best-effort per file).
  const { folders } = await list({ prefix: "ops/workflows/", mode: "folded", token: TOKEN });
  const maps = await Promise.all(
    folders.map((folder) =>
      readView(`${folder}renames.json`, RenameMap, { bust: runId }).catch(() => null),
    ),
  );
  const renameEntries = maps.flatMap((m) => m?.renames ?? []);

  const aliases = buildAliasMap(renameEntries, lookup);
  AliasMap.parse(aliases);
  await putView(`views/${runId}/lookup/aliases.json`, aliases);

  return { aliases: Object.keys(aliases).length, runs_scanned: maps.filter(Boolean).length };
}
