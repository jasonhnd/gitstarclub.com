import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { CATEGORY_RANK_PAGE_SIZE, categoryAllTimeRankPath } from "@/lib/categories/rank-pages";
import {
  AliasMap,
  CategoriesLookup,
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  Heatmap,
  Meta,
  OrgsLookup,
  RankList,
  RepoEntity,
  ReposLookup,
  SearchIndex,
  WhitelistSnapshot,
  WorkflowValidation,
} from "@/lib/contracts";
import { validateCanonicalGeneration } from "@/lib/workflows/canonical-validation";
import {
  validateAliases,
  validateAllTimeRanks,
  validateCategories,
  validateCategorySampleRanks,
  validateMeta,
  validateRepositoryMembership,
  validateSearchIndex,
  type ValidationInvariantReport,
} from "./validate-invariants";

export { HIGH_D_FACTOR_WARN_THRESHOLD, inspectAnchoringFactors } from "@/lib/workflows/canonical-validation";

// Publish gate. Reads key views from the freshly written version
// (views/<run_id>/**) and checks Zod schema + sanity invariants. Throwing here aborts
// the workflow BEFORE the pointer is switched, so a bad recompute never goes live.
// Note: stock curves are seam-anchored (frozen d) while current_stars is live, so we do
// NOT assert last_stock == current_stars here. See docs/VERCEL-DATA-OPERATIONS.md §8.

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
  const previousMeta = await readView("meta.json", Meta, { base: true, bust: runId });
  mergeValidationReport({ invariants, failures }, validateMeta(meta, previousMeta));

  const allTime = await read("rank/all-time/repo/stock.json", RankList);
  const allTimeOrg = await read("rank/all-time/org/stock.json", RankList);

  const lookup = await read("lookup/repos.json", ReposLookup);
  const orgLookup = await read("lookup/orgs.json", OrgsLookup);

  mergeValidationReport({ invariants, failures }, validateAllTimeRanks({ allTime, allTimeOrg, lookup, minLookup: MIN_LOOKUP, orgLookup }));
  let previousLookup: ReposLookup | null = null;
  try {
    previousLookup = await readView("lookup/repos.json", ReposLookup, { base: true, bust: runId });
  } catch (error) {
    schemaFailures++;
    failures.push(`previous lookup/repos: read/schema — ${error instanceof Error ? error.message : String(error)}`);
  }

  checked++;
  let whitelist: WhitelistSnapshot | null = null;
  try {
    whitelist = await readView(`canonical/v2/whitelist/${runId}.json`, WhitelistSnapshot, { bust: runId });
    if (!whitelist) failures.push(`canonical/v2/whitelist/${runId}.json: missing`);
    else if (whitelist.run_id !== runId) failures.push(`canonical whitelist run_id ${whitelist.run_id} does not match ${runId}`);
  } catch (error) {
    schemaFailures++;
    failures.push(`canonical/v2/whitelist/${runId}.json: schema — ${error instanceof Error ? error.message : String(error)}`);
  }

  const canonicalReport = await validateCanonicalGeneration(runId);
  checked += canonicalReport.checked;
  schemaFailures += canonicalReport.schemaFailures;
  Object.assign(invariants, canonicalReport.invariants);
  failures.push(...canonicalReport.failures);
  await putView(`ops/workflows/${runId}/canonical-manifest.json`, canonicalReport.manifest);
  mergeValidationReport(
    { invariants, failures },
    validateRepositoryMembership({ lookup, previousLookup, whitelist, canonicalRepoIds: canonicalReport.repoIds }),
  );

  // aliases must point at still-tracked ids and must not shadow a live repo's current full_name.
  const aliases = await read("lookup/aliases.json", AliasMap);
  const previousAliases = aliases && lookup ? await readView("lookup/aliases.json", AliasMap, { base: true, bust: runId }) : null;
  mergeValidationReport({ invariants, failures }, validateAliases(aliases, lookup, previousAliases));

  const search = await read("search/index.json", SearchIndex);
  mergeValidationReport({ invariants, failures }, validateSearchIndex(search, MIN_LOOKUP));

  const categoryRegistry = await read("categories/registry.json", CategoryRegistry);
  const categoryAssignments = await read("categories/assignments.json", CategoryAssignments);
  const categoriesLookup = await read("lookup/categories.json", CategoriesLookup);
  const categoryReport = validateCategories({ categoryAssignments, categoryRegistry, categoriesLookup, minLookup: MIN_LOOKUP });
  mergeValidationReport({ invariants, failures }, categoryReport);

  const sampleCategory = categoryReport.publicCategories[0];
  let categoryRank: CategoryRankList | null = null;
  let categoryRankPage2: CategoryRankList | null = null;
  if (sampleCategory) {
    categoryRank = await read(
      categoryAllTimeRankPath(sampleCategory.dimension, sampleCategory.slug),
      CategoryRankList,
    );

    if (sampleCategory.count > CATEGORY_RANK_PAGE_SIZE) {
      categoryRankPage2 = await read(
        categoryAllTimeRankPath(sampleCategory.dimension, sampleCategory.slug, 2),
        CategoryRankList,
      );
    }
  }
  mergeValidationReport({ invariants, failures }, validateCategorySampleRanks({ categoryAssignments, categoryRank, categoryRankPage2, sampleCategory }));

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

function mergeValidationReport(target: ValidationInvariantReport, report: ValidationInvariantReport) {
  Object.assign(target.invariants, report.invariants);
  target.failures.push(...report.failures);
}
