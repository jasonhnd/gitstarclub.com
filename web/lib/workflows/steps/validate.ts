import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { Heatmap, Meta, RankList, RepoEntity, ReposLookup, SearchIndex, WorkflowValidation } from "@/lib/contracts";

// Step 9 — publish gate. Reads key views from the freshly written version
// (views/<run_id>/**) and checks Zod schema + sanity invariants. Throwing here aborts
// the workflow BEFORE the pointer is switched, so a bad recompute never goes live.
// Note: stock curves are seam-anchored (frozen d) while current_stars is live, so we do
// NOT assert last_stock == current_stars here. See docs/VERCEL-DATA-OPERATIONS.md §3 (step 9) / §8.

const MIN_LOOKUP = 1000;

export async function validateVersion(runId: string): Promise<{ ok: boolean; checked: number; failures: string[] }> {
  "use step";
  const failures: string[] = [];
  const invariants: Record<string, boolean | number> = {};
  let checked = 0;
  let schemaFailures = 0;

  const read = async <T>(rel: string, schema: Parameters<typeof readView<T>>[1]): Promise<T | null> => {
    checked++;
    try {
      const v = await readView<T>(`views/${runId}/${rel}`, schema, { bust: runId });
      if (v === null) failures.push(`${rel}: missing`);
      return v;
    } catch (err) {
      schemaFailures++;
      failures.push(`${rel}: schema — ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const meta = await read("meta.json", Meta);
  if (meta) invariants.seam_date_present = Boolean((meta as { seam_date?: string }).seam_date);

  const allTime = await read("rank/all-time/repo/stock.json", RankList);
  if (allTime) {
    invariants.all_time_repo_items = allTime.items.length;
    if (allTime.items.length === 0) failures.push("all-time/repo: empty");
    if (allTime.items[0]?.rank !== 1) failures.push("all-time/repo: rank[0] != 1");
    const desc = allTime.items.every((it, i) => i === 0 || it.value <= allTime.items[i - 1].value);
    invariants.all_time_repo_desc = desc;
    if (!desc) failures.push("all-time/repo: values not descending");
  }

  const lookup = await read<Record<string, unknown>>("lookup/repos.json", ReposLookup);
  if (lookup) {
    const n = Object.keys(lookup).length;
    invariants.lookup_repos = n;
    if (n < MIN_LOOKUP) failures.push(`lookup/repos: only ${n} entries`);
  }

  const search = await read("search/index.json", SearchIndex);
  if (search) {
    invariants.search_repos = search.count;
    if (search.count < MIN_LOOKUP) failures.push(`search/index: only ${search.count} repos`);
    if (search.repos.length !== search.count) failures.push("search/index: count != repos.length");
  }

  // sample the top repo's entity — must have a non-empty anchored curve.
  const topId = allTime?.items[0]?.id;
  if (topId != null) {
    const ent = await read(`entity/repo/${topId}.json`, RepoEntity);
    if (ent) {
      invariants.sample_curve_months = ent.curve.monthly.length;
      if (ent.curve.monthly.length === 0) failures.push(`entity/repo/${topId}: empty curve`);
    }
  }

  // a heatmap year that must exist (prior calendar year is always complete).
  const lastYear = String(new Date().getUTCFullYear() - 1);
  await read(`heatmap/year/${lastYear}.json`, Heatmap);

  const ok = failures.length === 0;
  const validation = { run_id: runId, ok, checked, schema_failures: schemaFailures, invariants, failures };
  WorkflowValidation.parse(validation);
  await putView(`ops/workflows/${runId}/validation.json`, validation);
  if (!ok) throw new Error(`validation failed (${failures.length}): ${failures.slice(0, 5).join("; ")}`);
  return { ok, checked, failures };
}
