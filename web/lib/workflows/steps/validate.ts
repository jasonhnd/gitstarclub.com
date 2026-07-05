import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
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
  ReposShard,
  ReposLookup,
  SearchIndex,
  WorkflowValidation,
} from "@/lib/contracts";
import type { CategoryRegistryEntry, RankItem } from "@/lib/contracts";
import { REPO_BUCKETS } from "@/lib/workflows/buckets";

// Publish gate. Reads key views from the freshly written version
// (views/<run_id>/**) and checks Zod schema + sanity invariants. Throwing here aborts
// the workflow BEFORE the pointer is switched, so a bad recompute never goes live.
// Note: stock curves are seam-anchored (frozen d) while current_stars is live, so we do
// NOT assert last_stock == current_stars here. See docs/VERCEL-DATA-OPERATIONS.md §8.

const MIN_LOOKUP = 1000;
export const HIGH_D_FACTOR_WARN_THRESHOLD = 2;

type ValidationInvariants = Record<string, boolean | number>;

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
  Object.assign(invariants, validateMeta(meta, null, failures));

  const allTime = await read("rank/all-time/repo/stock.json", RankList);
  const allTimeOrg = await read("rank/all-time/org/stock.json", RankList);

  const lookup = await read("lookup/repos.json", ReposLookup);
  const orgLookup = await read("lookup/orgs.json", OrgsLookup);

  Object.assign(invariants, validateAllTimeRanks({ allTime, allTimeOrg, lookup, orgLookup }, failures));
  const dFactorReport = await inspectCanonicalAnchoringFactors(runId);
  checked += dFactorReport.checked;
  Object.assign(invariants, dFactorReport.invariants);

  const previousMeta = await readView("meta.json", Meta, { base: true, bust: runId });
  Object.assign(invariants, validateMetaFoldedThrough(meta, previousMeta, failures));

  // aliases must point at still-tracked ids and must not shadow a live repo's current full_name.
  const aliases = await read("lookup/aliases.json", AliasMap);
  if (aliases && lookup) {
    Object.assign(invariants, validateAliases(aliases, lookup, failures));

    const previousAliases = await readView("lookup/aliases.json", AliasMap, { base: true, bust: runId });
    Object.assign(invariants, validateAliasNonRegression(aliases, previousAliases, failures));
  }

  const search = await read("search/index.json", SearchIndex);
  Object.assign(invariants, validateSearchIndex(search, failures));

  const categoryRegistry = await read("categories/registry.json", CategoryRegistry);
  const categoryAssignments = await read("categories/assignments.json", CategoryAssignments);
  const categoriesLookup = await read("lookup/categories.json", CategoriesLookup);
  const categoryReport = validateCategories({ categoryRegistry, categoryAssignments, categoriesLookup }, failures);
  Object.assign(invariants, categoryReport.invariants);

  const sampleCategory = categoryReport.publicCategories[0];
  if (sampleCategory) {
    const categoryRank = await read(
      `rank/category/${sampleCategory.dimension}/${sampleCategory.slug}/all-time/repo/stock.json`,
      CategoryRankList,
    );
    Object.assign(invariants, validateCategorySampleRank(sampleCategory, categoryRank, categoryAssignments, failures));
  }

  // sample the top repo's entity — must have a non-empty anchored curve.
  const topId = allTime?.items[0]?.id;
  if (topId != null) {
    const ent = await read(`entity/repo/${topId}.json`, RepoEntity);
    Object.assign(invariants, validateRepoEntitySample(topId, ent, failures));
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

export function validateMeta(meta: Meta | null, previousMeta: Meta | null, failures: string[]): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (meta) invariants.seam_date_present = Boolean(meta.seam_date);
  if (previousMeta) Object.assign(invariants, validateMetaFoldedThrough(meta, previousMeta, failures));
  return invariants;
}

export function validateMetaFoldedThrough(meta: Meta | null, previousMeta: Meta | null, failures: string[]): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (meta?.folded_through && previousMeta?.folded_through) {
    const monotonic =
      meta.folded_through.month >= previousMeta.folded_through.month &&
      meta.folded_through.week >= previousMeta.folded_through.week;
    invariants.folded_through_monotonic = monotonic;
    if (!monotonic) {
      failures.push(
        `meta.folded_through regressed from ${previousMeta.folded_through.month}/${previousMeta.folded_through.week} to ${meta.folded_through.month}/${meta.folded_through.week}`,
      );
    }
  }
  return invariants;
}

export function validateAllTimeRanks(
  {
    allTime,
    allTimeOrg,
    lookup,
    orgLookup,
  }: {
    allTime: RankList | null;
    allTimeOrg: RankList | null;
    lookup: ReposLookup | null;
    orgLookup: OrgsLookup | null;
  },
  failures: string[],
): ValidationInvariants {
  const invariants: ValidationInvariants = {};

  if (allTime) {
    invariants.all_time_repo_items = allTime.items.length;
    if (allTime.items.length === 0) failures.push("all-time/repo: empty");
    if (allTime.items[0]?.rank !== 1) failures.push("all-time/repo: rank[0] != 1");
  }

  if (lookup) {
    const n = Object.keys(lookup).length;
    invariants.lookup_repos = n;
    if (n < MIN_LOOKUP) failures.push(`lookup/repos: only ${n} entries`);
  }

  if (allTime && lookup) Object.assign(invariants, inspectRank("all-time/repo", allTime, failures, { lookup }).invariants);
  if (allTimeOrg && orgLookup) Object.assign(invariants, inspectRank("all-time/org", allTimeOrg, failures, { orgLookup }).invariants);
  return invariants;
}

export function validateAliases(aliases: AliasMap, lookup: ReposLookup, failures: string[]): ValidationInvariants {
  const trackedIds = new Set(Object.keys(lookup));
  const liveNames = new Set(Object.values(lookup).map((e) => e.full_name.toLowerCase()));
  let dangling = 0;
  let colliding = 0;
  for (const [oldName, id] of Object.entries(aliases)) {
    if (!trackedIds.has(String(id))) dangling++;
    if (liveNames.has(oldName)) colliding++;
  }

  const invariants: ValidationInvariants = {
    alias_count: Object.keys(aliases).length,
    alias_dangling: dangling,
    alias_colliding: colliding,
  };
  if (dangling > 0) failures.push(`lookup/aliases: ${dangling} alias(es) point to an untracked id`);
  if (colliding > 0) failures.push(`lookup/aliases: ${colliding} alias(es) shadow a live repo`);
  return invariants;
}

export function validateAliasNonRegression(
  aliases: AliasMap,
  previousAliases: AliasMap | null,
  failures: string[],
): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (previousAliases) {
    const previousCount = Object.keys(previousAliases).length;
    const currentCount = Object.keys(aliases).length;
    invariants.alias_prev_count = previousCount;
    invariants.alias_non_regression = currentCount >= previousCount;
    if (currentCount < previousCount) failures.push(`lookup/aliases: count regressed from ${previousCount} to ${currentCount}`);
  }
  return invariants;
}

export function validateSearchIndex(search: SearchIndex | null, failures: string[]): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (search) {
    invariants.search_repos = search.count;
    if (search.count < MIN_LOOKUP) failures.push(`search/index: only ${search.count} repos`);
  }
  return invariants;
}

export function validateCategories(
  {
    categoryRegistry,
    categoryAssignments,
    categoriesLookup,
  }: {
    categoryRegistry: CategoryRegistry | null;
    categoryAssignments: CategoryAssignments | null;
    categoriesLookup: CategoriesLookup | null;
  },
  failures: string[],
): { invariants: ValidationInvariants; publicCategories: CategoryRegistryEntry[] } {
  const invariants: ValidationInvariants = {};
  const categoryIds = new Set<string>();
  const publicCategories = categoryRegistry?.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public)) ?? [];

  if (categoryRegistry) {
    const categoryCount = categoryRegistry.dimensions.reduce((sum, dimension) => sum + dimension.categories.length, 0);
    invariants.category_registry_categories = categoryCount;
    invariants.category_public_categories = publicCategories.length;
    for (const dimension of categoryRegistry.dimensions) for (const category of dimension.categories) categoryIds.add(category.id);
    if (categoryCount === 0) failures.push("categories/registry: empty");
    if (publicCategories.length === 0) failures.push("categories/registry: no public categories");
  }

  if (categoryAssignments) {
    const assignments = Object.values(categoryAssignments.repositories);
    invariants.category_assignments_repos = assignments.length;
    if (assignments.length < MIN_LOOKUP) failures.push(`categories/assignments: only ${assignments.length} repos`);

    const hasLanguage = assignments.every((assignment) => assignment.language.length >= 1);
    const hasLanguageFamily = assignments.every((assignment) => assignment.language_family.length >= 1);
    const singleOwnerKind = assignments.every((assignment) => assignment.owner_kind.length === 1);
    invariants.category_has_language = hasLanguage;
    invariants.category_has_language_family = hasLanguageFamily;
    invariants.category_single_owner_kind = singleOwnerKind;
    if (!hasLanguage) failures.push("categories/assignments: language must have at least one category per repo");
    if (!hasLanguageFamily) failures.push("categories/assignments: language_family must have at least one category per repo");
    if (!singleOwnerKind) failures.push("categories/assignments: owner_kind must have exactly one category per repo");

    if (categoryIds.size) {
      let unknownRefs = 0;
      for (const assignment of assignments) {
        for (const refs of Object.values(assignment)) {
          for (const ref of refs) if (!categoryIds.has(ref)) unknownRefs++;
        }
      }
      invariants.category_unknown_refs = unknownRefs;
      if (unknownRefs > 0) failures.push(`categories/assignments: ${unknownRefs} unknown category refs`);
    }
  }

  if (categoriesLookup) {
    const lookupCategories = categoriesLookup.dimensions.reduce((sum, dimension) => sum + dimension.categories.length, 0);
    invariants.categories_lookup_categories = lookupCategories;
    if (lookupCategories === 0) failures.push("lookup/categories: empty");
  }

  return { invariants, publicCategories };
}

export function validateCategorySampleRank(
  sampleCategory: CategoryRegistryEntry,
  categoryRank: CategoryRankList | null,
  categoryAssignments: CategoryAssignments | null,
  failures: string[],
): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (categoryRank && categoryAssignments) {
    const rankItemsAssigned = categoryRank.items.every((item) => {
      if (item.id == null) return false;
      return categoryAssignments.repositories[String(item.id)]?.[sampleCategory.dimension].includes(sampleCategory.id) ?? false;
    });
    invariants.category_sample_rank_items_assigned = rankItemsAssigned;
    if (!rankItemsAssigned) failures.push(`rank/category/${sampleCategory.id}: contains unassigned repo`);
  }
  return invariants;
}

export function validateRepoEntitySample(topId: number, ent: RepoEntity | null, failures: string[]): ValidationInvariants {
  const invariants: ValidationInvariants = {};
  if (ent) {
    invariants.sample_curve_months = ent.curve.monthly.length;
    if (ent.curve.monthly.length === 0) failures.push(`entity/repo/${topId}: empty curve`);
  }
  return invariants;
}

type AnchoringShard = Record<string, { d?: number | null }>;

export function inspectAnchoringFactors(
  shards: AnchoringShard[],
  threshold = HIGH_D_FACTOR_WARN_THRESHOLD,
): Record<string, boolean | number> {
  let reposChecked = 0;
  let reposWithD = 0;
  let highCount = 0;
  let maxD = 0;

  for (const shard of shards) {
    for (const repo of Object.values(shard)) {
      reposChecked++;
      if (typeof repo.d !== "number" || !Number.isFinite(repo.d)) continue;
      reposWithD++;
      maxD = Math.max(maxD, repo.d);
      if (repo.d > threshold) highCount++;
    }
  }

  return {
    d_factor_warn_threshold: threshold,
    d_factor_repos_checked: reposChecked,
    d_factor_repos_with_d: reposWithD,
    d_factor_high_count: highCount,
    d_factor_max: Math.round(maxD * 1000) / 1000,
    d_factor_warning: highCount > 0,
  };
}

async function inspectCanonicalAnchoringFactors(
  runId: string,
): Promise<{ checked: number; invariants: Record<string, boolean | number> }> {
  const shards: AnchoringShard[] = [];
  let missing = 0;
  let schemaErrors = 0;

  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    try {
      const shard = await readView(`canonical/v2/repos/${bucket}.json`, ReposShard, { bust: runId });
      if (shard) shards.push(shard);
      else missing++;
    } catch {
      schemaErrors++;
    }
  }

  return {
    checked: REPO_BUCKETS,
    invariants: {
      ...inspectAnchoringFactors(shards),
      d_factor_canonical_shards: REPO_BUCKETS,
      d_factor_canonical_missing: missing,
      d_factor_canonical_schema_errors: schemaErrors,
    },
  };
}

function inspectRank(
  label: string,
  rank: RankList,
  failures: string[],
  refs: { lookup?: ReposLookup; orgLookup?: OrgsLookup } = {},
): { invariants: Record<string, boolean | number> } {
  const invariants: Record<string, boolean | number> = {};
  const seenRanks = new Set<number>();
  const seenKeys = new Set<string>();
  let duplicateRanks = 0;
  let duplicateKeys = 0;
  let missingRefs = 0;
  let sequential = true;
  let desc = true;

  rank.items.forEach((item, index) => {
    if (item.rank !== index + 1) sequential = false;
    if (index > 0 && item.value > rank.items[index - 1].value) desc = false;
    if (seenRanks.has(item.rank)) duplicateRanks++;
    seenRanks.add(item.rank);
    const key = itemKey(item);
    if (key == null) {
      missingRefs++;
      return;
    }
    if (seenKeys.has(key)) duplicateKeys++;
    seenKeys.add(key);
    if (rank.meta.dim === "repo" && refs.lookup && item.id != null && !refs.lookup[String(item.id)]) missingRefs++;
    if (rank.meta.dim === "org" && refs.orgLookup && item.login && !refs.orgLookup[item.login]) missingRefs++;
  });

  const prefix = label.replaceAll(/[^a-z0-9]+/gi, "_").toLowerCase();
  invariants[`${prefix}_rank_sequential`] = sequential;
  invariants[`${prefix}_values_desc`] = desc;
  invariants[`${prefix}_duplicate_ranks`] = duplicateRanks;
  invariants[`${prefix}_duplicate_ids`] = duplicateKeys;
  invariants[`${prefix}_missing_refs`] = missingRefs;
  if (!sequential) failures.push(`${label}: ranks are not sequential from 1`);
  if (!desc) failures.push(`${label}: values not descending`);
  if (duplicateRanks > 0) failures.push(`${label}: ${duplicateRanks} duplicate rank value(s)`);
  if (duplicateKeys > 0) failures.push(`${label}: ${duplicateKeys} duplicate item id/login value(s)`);
  if (missingRefs > 0) failures.push(`${label}: ${missingRefs} missing id/login reference(s)`);
  return { invariants };
}

function itemKey(item: RankItem): string | null {
  if (item.id != null) return `repo:${item.id}`;
  if (item.login != null) return `org:${item.login}`;
  return null;
}
