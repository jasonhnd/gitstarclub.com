import { z } from "zod";
import { OrgsLookup, OrgEntity, RankList, RepoEntity, ReposLookup, WorkflowValidation } from "@/lib/contracts";
import { mapLimit } from "@/lib/data/map-limit";
import { readAuthoritativeView } from "@/lib/data/source";
import { sanitizeErrorText } from "@/lib/observability/sanitize-error";
import { putOwnedView } from "../owned-write";
import { readPackedWindowMeta } from "../recompute/io";
import type { RefreshCursor } from "../runtime/types";
import { inspectRank } from "./validate-invariants";
import { validateVersion } from "./validate";

/** Leaves room for checkpoint writes, lease CAS, retries and queue advancement. */
export const VALIDATION_READS_PER_HOP = 128;

const ValidationPlan = z.object({ paths: z.array(z.string()) });
const progressPath = (runId: string, offset: number) => `ops/workflows/${runId}/validate/progress-${offset}.json`;
const planPath = (runId: string) => `ops/workflows/${runId}/validate/plan.json`;

async function finish(runId: string, fencingToken: number, report: WorkflowValidation) {
  report.ok = report.failures.length === 0;
  report.failures = report.failures.map((failure) => sanitizeErrorText(failure));
  await putOwnedView({ runId, fencingToken }, `ops/workflows/${runId}/validation.json`, WorkflowValidation.parse(report));
  if (!report.ok) throw new Error(`validation failed (${report.failures.length}): ${report.failures.slice(0, 5).join("; ")}`);
  return { ok: true, checked: report.checked, failures: report.failures };
}

/**
 * Core checks are fixed-size (canonical and metadata buckets). The persisted
 * inventory then checks every required rank and entity in 128-read pages.
 * Each page reads its predecessor's report, so redelivery cannot double-count.
 */
export async function runValidateStep(runId: string, fencingToken: number, cursor: RefreshCursor = {}) {
  const owner = { runId, fencingToken };
  const offset = cursor.workOffset ?? 0;
  if (offset === 0) {
    const report = await validateVersion(runId, fencingToken, { deferBulk: true });
    const paths: string[] = [];
    for (const kind of ["month", "week", "year"] as const) {
      const manifest = await readPackedWindowMeta(runId, kind);
      if (!manifest) {
        report.failures.push(`ops/workflows/${runId}/recompute/${kind}-win/meta.json: missing or invalid period inventory`);
        continue;
      }
      for (const period of manifest.periods) {
        for (const dim of ["repo", "org"]) {
          for (const metric of ["flow", "stock"]) paths.push(`rank/${kind}/${period}/${dim}/${metric}.json`);
        }
      }
    }
    const lookup = await readAuthoritativeView(`views/${runId}/lookup/repos.json`, ReposLookup, { bust: runId });
    const orgs = await readAuthoritativeView(`views/${runId}/lookup/orgs.json`, OrgsLookup, { bust: runId });
    paths.push(...Object.keys(lookup ?? {}).map((id) => `entity/repo/${id}.json`));
    paths.push(...Object.keys(orgs ?? {}).map((login) => `entity/org/${login}.json`));
    Object.assign(report.invariants, { period_rank_files_checked: 0, entity_repos_checked: 0, entity_orgs_checked: 0 });
    if (report.failures.length > 0 || paths.length === 0) return finish(runId, fencingToken, report);
    await putOwnedView(owner, planPath(runId), { paths });
    await putOwnedView(owner, progressPath(runId, 0), report);
    return { nextWorkOffset: 1 };
  }

  const plan = await readAuthoritativeView(planPath(runId), ValidationPlan, { bust: runId });
  const report = await readAuthoritativeView(progressPath(runId, offset - 1), WorkflowValidation, { bust: runId });
  if (!plan || !report) throw new Error(`validate page ${offset}: missing predecessor checkpoint`);
  const from = (offset - 1) * VALIDATION_READS_PER_HOP;
  if (from >= plan.paths.length) throw new Error(`validate page ${offset}: outside persisted inventory`);
  const paths = plan.paths.slice(from, from + VALIDATION_READS_PER_HOP);
  const lookup = await readAuthoritativeView(`views/${runId}/lookup/repos.json`, ReposLookup, { bust: runId });
  const orgLookup = await readAuthoritativeView(`views/${runId}/lookup/orgs.json`, OrgsLookup, { bust: runId });
  await mapLimit(paths, 4, async (rel) => {
    report.checked++;
    const rankParts = /^rank\/(month|week|year)\/([^/]+)\/(repo|org)\/(flow|stock)\.json$/.exec(rel);
    const schema = rankParts ? RankList : rel.startsWith("entity/repo/") ? RepoEntity : OrgEntity;
    const invariant = rankParts ? "period_rank_files_checked" : rel.startsWith("entity/repo/") ? "entity_repos_checked" : "entity_orgs_checked";
    report.invariants[invariant] = Number(report.invariants[invariant] ?? 0) + 1;
    try {
      const value = await readAuthoritativeView(`views/${runId}/${rel}`, schema as z.ZodType, { bust: runId });
      if (value === null) report.failures.push(`${rel}: missing`);
      else if (rankParts) {
        const rank = RankList.parse(value);
        if (rank.meta.window !== rankParts[1] || rank.meta.period !== rankParts[2] || rank.meta.dim !== rankParts[3] || rank.meta.metric !== rankParts[4]) {
          report.failures.push(`${rel}: metadata does not match artifact path`);
        }
        report.failures.push(...inspectRank(rel, rank, { lookup: lookup ?? undefined, orgLookup: orgLookup ?? undefined }).failures);
      }
    } catch (error) {
      report.schema_failures++;
      report.failures.push(`${rel}: schema — ${sanitizeErrorText(error instanceof Error ? error.message : String(error))}`);
    }
  });
  report.failures = report.failures.map((failure) => sanitizeErrorText(failure));
  await putOwnedView(owner, progressPath(runId, offset), report);
  if (from + paths.length < plan.paths.length) return { nextWorkOffset: offset + 1 };
  return finish(runId, fencingToken, report);
}
