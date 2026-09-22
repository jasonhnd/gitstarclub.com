import { CanonicalMeta, ReposLookup, ReposShard, ViewsPointer } from "@/lib/contracts";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { isWorkflowColdStartEnabled } from "@/lib/runtime-config";
import { utcMonthPeriod } from "@/lib/workflows/steps/fold";
import { endOfMonth, weekIdOf } from "@/lib/workflows/steps/week-dates";
import { putOwnedView } from "@/lib/workflows/owned-write";
import type { WorkflowOwnership } from "@/lib/workflows/lease";
import type { ReposShardEntry } from "@/lib/contracts";
import { readCanonicalPreflight, type CanonicalPreflightResult } from "@/lib/workflows/canonical-preflight";

/** True when preview cold-start is enabled and no managed views pointer is published yet. */
export async function isManagedViewsUnpublished(bust?: string): Promise<boolean> {
  const pointer = await readAuthoritativeView("views/latest.json", ViewsPointer, { bust });
  return pointer === null;
}

export async function isCanonicalMetaAbsent(bust?: string): Promise<boolean> {
  const meta = await readAuthoritativeView("canonical/v2/meta.json", CanonicalMeta, { bust });
  return meta === null;
}

/** Missing canonical / lookup inputs may be treated as empty only during the first publish. */
export async function isUniverseColdStartActive(bust?: string): Promise<boolean> {
  return isWorkflowColdStartEnabled() && (await isManagedViewsUnpublished(bust));
}

/**
 * Minimal honest meta for a universe with no GH Archive gross history: seam is
 * the bootstrap UTC day, fold watermarks sit on the last closed month/week.
 */
export function buildColdStartCanonicalMeta(now: Date): CanonicalMeta {
  const seamDate = now.toISOString().slice(0, 10);
  const currentMonth = utcMonthPeriod(now);
  const [year, month] = currentMonth.split("-").map(Number);
  const foldedThroughMonth =
    month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const foldedThroughWeek = weekIdOf(endOfMonth(foldedThroughMonth));
  return CanonicalMeta.parse({
    seam_date: seamDate,
    schema_ver: 2,
    folded_through: { month: foldedThroughMonth, week: foldedThroughWeek },
    generated_at: now.toISOString(),
  });
}

export function coldStartPreflightFromMeta(meta: CanonicalMeta): CanonicalPreflightResult {
  return {
    seam_date: meta.seam_date,
    schema_ver: meta.schema_ver,
    folded_through: meta.folded_through,
    generated_at: meta.generated_at ?? null,
  };
}

/** Route gate: allow enqueue when canonical meta is absent but preview cold-start is armed. */
export async function readRefreshStartPreflight(runId: string): Promise<CanonicalPreflightResult> {
  if (!(await isUniverseColdStartActive(`${runId}-route-preflight`))) {
    return readCanonicalPreflight(runId, "route");
  }
  const bust = `${runId}-route-preflight`;
  const existing = await readAuthoritativeView("canonical/v2/meta.json", CanonicalMeta, { bust });
  if (existing) {
    return readCanonicalPreflight(runId, "route");
  }
  const planned = buildColdStartCanonicalMeta(new Date());
  console.log("[workflow-refresh] cold-start route preflight (meta absent, views unpublished)", {
    run_id: runId,
    seam_date: planned.seam_date,
    folded_through: planned.folded_through,
  });
  return coldStartPreflightFromMeta(planned);
}

/** Write canonical/v2/meta.json once when the universe has no prior meta. Idempotent. */
export async function ensureColdStartCanonicalMeta(owner: WorkflowOwnership, now = new Date()): Promise<boolean> {
  if (!(await isUniverseColdStartActive(`${owner.runId}-workflow-preflight`))) return false;
  const bust = `${owner.runId}-workflow-preflight`;
  const existing = await readAuthoritativeView("canonical/v2/meta.json", CanonicalMeta, { bust });
  if (existing) return false;
  const meta = buildColdStartCanonicalMeta(now);
  await putOwnedView(owner, "canonical/v2/meta.json", meta);
  console.log("[workflow-refresh] cold-start bootstrap wrote canonical/v2/meta.json", {
    run_id: owner.runId,
    seam_date: meta.seam_date,
    folded_through: meta.folded_through,
    generated_at: meta.generated_at,
  });
  return true;
}

export async function readColdStartLookupOrEmpty(runId: string): Promise<ReposLookup> {
  if (!(await isUniverseColdStartActive(runId))) {
    return readRequiredView("lookup/repos.json", ReposLookup, { base: true, bust: runId });
  }
  const lookup = await readAuthoritativeView("lookup/repos.json", ReposLookup, { base: true, bust: runId });
  return lookup ?? {};
}

export async function readColdStartReposShardOrEmpty(
  runId: string,
  bucket: number,
): Promise<Record<string, ReposShardEntry>> {
  const path = `canonical/v2/repos/${bucket}.json`;
  if (!(await isUniverseColdStartActive(runId))) {
    return readRequiredView(path, ReposShard, { bust: runId });
  }
  const shard = await readAuthoritativeView(path, ReposShard, { bust: runId });
  return shard ?? {};
}
