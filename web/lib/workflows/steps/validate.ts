import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import {
  CategoriesLookup,
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  Heatmap,
  Meta,
  RankList,
  RepoEntity,
  ReposLookup,
  SearchIndex,
  WorkflowValidation,
} from "@/lib/contracts";

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

  const categoryRegistry = await read("categories/registry.json", CategoryRegistry);
  const categoryAssignments = await read("categories/assignments.json", CategoryAssignments);
  const categoriesLookup = await read("lookup/categories.json", CategoriesLookup);
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

    const singleLanguage = assignments.every((assignment) => assignment.language.length === 1);
    const singleLanguageFamily = assignments.every((assignment) => assignment.language_family.length === 1);
    const singleOwnerKind = assignments.every((assignment) => assignment.owner_kind.length === 1);
    invariants.category_single_language = singleLanguage;
    invariants.category_single_language_family = singleLanguageFamily;
    invariants.category_single_owner_kind = singleOwnerKind;
    if (!singleLanguage) failures.push("categories/assignments: language must have exactly one category per repo");
    if (!singleLanguageFamily) failures.push("categories/assignments: language_family must have exactly one category per repo");
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

  const sampleCategory = publicCategories[0];
  if (sampleCategory) {
    const categoryRank = await read(
      `rank/category/${sampleCategory.dimension}/${sampleCategory.slug}/all-time/repo/stock.json`,
      CategoryRankList,
    );
    if (categoryRank && categoryAssignments) {
      const rankItemsAssigned = categoryRank.items.every((item) => {
        if (item.id == null) return false;
        return categoryAssignments.repositories[String(item.id)]?.[sampleCategory.dimension].includes(sampleCategory.id) ?? false;
      });
      invariants.category_sample_rank_items_assigned = rankItemsAssigned;
      if (!rankItemsAssigned) failures.push(`rank/category/${sampleCategory.id}: contains unassigned repo`);
    }
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
