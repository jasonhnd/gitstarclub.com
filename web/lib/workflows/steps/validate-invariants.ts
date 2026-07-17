import { CATEGORY_RANK_PAGE_SIZE } from "@/lib/categories/rank-pages";
import type {
  AliasMap,
  CategoriesLookup,
  CategoryAssignments,
  CategoryRankList,
  CategoryRegistry,
  CategoryRegistryEntry,
  Meta,
  OrgsLookup,
  RankItem,
  RankList,
  ReposLookup,
  SearchIndex,
  WhitelistSnapshot,
} from "@/lib/contracts";

export type ValidationInvariants = Record<string, boolean | number>;
export type ValidationInvariantReport = { invariants: ValidationInvariants; failures: string[] };

export function validateMeta(meta: Meta | null, previousMeta: Meta | null): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];

  if (meta) invariants.seam_date_present = Boolean((meta as { seam_date?: string }).seam_date);

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

  return { invariants, failures };
}

export function validateAllTimeRanks({
  allTime,
  allTimeOrg,
  lookup,
  minLookup,
  orgLookup,
}: {
  allTime: RankList | null;
  allTimeOrg: RankList | null;
  lookup: ReposLookup | null;
  minLookup: number;
  orgLookup: OrgsLookup | null;
}): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];

  if (allTime) {
    invariants.all_time_repo_items = allTime.items.length;
    if (allTime.items.length === 0) failures.push("all-time/repo: empty");
    if (allTime.items[0]?.rank !== 1) failures.push("all-time/repo: rank[0] != 1");
  }

  if (lookup) {
    const n = Object.keys(lookup).length;
    invariants.lookup_repos = n;
    if (n < minLookup) failures.push(`lookup/repos: only ${n} entries`);
  }

  if (allTime && lookup) mergeReport({ invariants, failures }, inspectRank("all-time/repo", allTime, { lookup }));
  if (allTimeOrg && orgLookup) mergeReport({ invariants, failures }, inspectRank("all-time/org", allTimeOrg, { orgLookup }));

  return { invariants, failures };
}

export function validateRepositoryMembership({
  lookup,
  previousLookup,
  whitelist,
  canonicalRepoIds,
}: {
  lookup: ReposLookup | null;
  previousLookup: ReposLookup | null;
  whitelist: WhitelistSnapshot | null;
  canonicalRepoIds: ReadonlySet<string>;
}): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
  if (!lookup) return { invariants, failures };

  const currentIds = new Set(Object.keys(lookup));
  const canonicalMissing = [...canonicalRepoIds].filter((id) => !currentIds.has(id));
  const canonicalUnexpected = [...currentIds].filter((id) => !canonicalRepoIds.has(id));
  invariants.membership_current_repos = currentIds.size;
  invariants.membership_canonical_repos = canonicalRepoIds.size;
  invariants.membership_canonical_missing = canonicalMissing.length;
  invariants.membership_canonical_unexpected = canonicalUnexpected.length;
  if (canonicalMissing.length > 0) {
    failures.push(`lookup/repos: missing ${canonicalMissing.length} canonical id(s), e.g. ${canonicalMissing.slice(0, 5).join(",")}`);
  }
  if (canonicalUnexpected.length > 0) {
    failures.push(`lookup/repos: contains ${canonicalUnexpected.length} id(s) absent from canonical, e.g. ${canonicalUnexpected.slice(0, 5).join(",")}`);
  }

  if (whitelist) {
    const activeIds = new Set(whitelist.entries.map((entry) => String(entry.id)));
    const activeMissing = [...activeIds].filter((id) => !currentIds.has(id));
    invariants.membership_active_whitelist = activeIds.size;
    invariants.membership_active_missing = activeMissing.length;
    if (activeMissing.length > 0) {
      failures.push(`lookup/repos: missing ${activeMissing.length} active whitelist id(s), e.g. ${activeMissing.slice(0, 5).join(",")}`);
    }

    const added = new Set(whitelist.diff.added.map(String));
    const dropped = new Set(whitelist.diff.dropped.map(String));
    const addedNotActive = [...added].filter((id) => !activeIds.has(id));
    const droppedStillActive = [...dropped].filter((id) => activeIds.has(id));
    invariants.membership_added_not_active = addedNotActive.length;
    invariants.membership_dropped_still_active = droppedStillActive.length;
    if (addedNotActive.length > 0) failures.push(`whitelist diff: ${addedNotActive.length} added id(s) are absent from entries`);
    if (droppedStillActive.length > 0) failures.push(`whitelist diff: ${droppedStillActive.length} dropped id(s) remain active`);

    if (previousLookup) {
      const previousIds = new Set(Object.keys(previousLookup));
      const expectedIds = new Set(previousIds);
      for (const id of added) expectedIds.add(id);
      // Dropped repositories remain in the Chronicle read model; only active polling stops.
      const missingExpected = [...expectedIds].filter((id) => !currentIds.has(id));
      const unapproved = [...currentIds].filter((id) => !expectedIds.has(id));
      const addedAlreadyPresent = [...added].filter((id) => previousIds.has(id));
      invariants.membership_previous_repos = previousIds.size;
      invariants.membership_expected_repos = expectedIds.size;
      invariants.membership_missing_expected = missingExpected.length;
      invariants.membership_unapproved_additions = unapproved.length;
      invariants.membership_added_already_present = addedAlreadyPresent.length;
      if (missingExpected.length > 0) {
        failures.push(`lookup/repos: lost ${missingExpected.length} previously tracked/approved id(s), e.g. ${missingExpected.slice(0, 5).join(",")}`);
      }
      if (unapproved.length > 0) {
        failures.push(`lookup/repos: contains ${unapproved.length} unapproved new id(s), e.g. ${unapproved.slice(0, 5).join(",")}`);
      }
      if (addedAlreadyPresent.length > 0) failures.push(`whitelist diff: ${addedAlreadyPresent.length} added id(s) already existed previously`);
    }
  }

  return { invariants, failures };
}

export function validateAliases(aliases: AliasMap | null, lookup: ReposLookup | null, previousAliases: AliasMap | null): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
  if (!aliases || !lookup) return { invariants, failures };

  const trackedIds = new Set(Object.keys(lookup));
  const liveNames = new Set(Object.values(lookup).map((entry) => entry.full_name.toLowerCase()));
  let dangling = 0;
  let colliding = 0;
  for (const [oldName, id] of Object.entries(aliases)) {
    if (!trackedIds.has(String(id))) dangling++;
    if (liveNames.has(oldName)) colliding++;
  }
  invariants.alias_count = Object.keys(aliases).length;
  invariants.alias_dangling = dangling;
  invariants.alias_colliding = colliding;
  if (dangling > 0) failures.push(`lookup/aliases: ${dangling} alias(es) point to an untracked id`);
  if (colliding > 0) failures.push(`lookup/aliases: ${colliding} alias(es) shadow a live repo`);

  if (previousAliases) {
    const previousCount = Object.keys(previousAliases).length;
    const currentCount = Object.keys(aliases).length;
    invariants.alias_prev_count = previousCount;
    invariants.alias_non_regression = currentCount >= previousCount;
    if (currentCount < previousCount) failures.push(`lookup/aliases: count regressed from ${previousCount} to ${currentCount}`);
  }

  return { invariants, failures };
}

export function validateSearchIndex(search: SearchIndex | null, minLookup: number): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
  if (!search) return { invariants, failures };

  invariants.search_repos = search.count;
  if (search.count < minLookup) failures.push(`search/index: only ${search.count} repos`);
  return { invariants, failures };
}

export function validateCategories({
  categoryAssignments,
  categoryRegistry,
  categoriesLookup,
  minLookup,
}: {
  categoryAssignments: CategoryAssignments | null;
  categoryRegistry: CategoryRegistry | null;
  categoriesLookup: CategoriesLookup | null;
  minLookup: number;
}): ValidationInvariantReport & { publicCategories: CategoryRegistryEntry[] } {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
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
    if (assignments.length < minLookup) failures.push(`categories/assignments: only ${assignments.length} repos`);

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

  return { invariants, failures, publicCategories };
}

export function validateCategorySampleRanks({
  categoryAssignments,
  categoryRank,
  categoryRankPage2,
  sampleCategory,
}: {
  categoryAssignments: CategoryAssignments | null;
  categoryRank: CategoryRankList | null;
  categoryRankPage2: CategoryRankList | null;
  sampleCategory: CategoryRegistryEntry | undefined;
}): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
  if (!sampleCategory) return { invariants, failures };

  if (categoryRank && categoryAssignments) {
    const rankItemsAssigned = categoryRank.items.every((item) => {
      if (item.id == null) return false;
      return categoryAssignments.repositories[String(item.id)]?.[sampleCategory.dimension].includes(sampleCategory.id) ?? false;
    });
    invariants.category_sample_rank_items_assigned = rankItemsAssigned;
    if (!rankItemsAssigned) failures.push(`rank/category/${sampleCategory.id}: contains unassigned repo`);
  }

  if (sampleCategory.count > CATEGORY_RANK_PAGE_SIZE && categoryRankPage2 && categoryAssignments) {
    const pageItemsAssigned = categoryRankPage2.items.every((item) => {
      if (item.id == null) return false;
      return categoryAssignments.repositories[String(item.id)]?.[sampleCategory.dimension].includes(sampleCategory.id) ?? false;
    });
    const pageRanksContinue = categoryRankPage2.items[0]?.rank === CATEGORY_RANK_PAGE_SIZE + 1;
    invariants.category_sample_rank_page_2_items_assigned = pageItemsAssigned;
    invariants.category_sample_rank_page_2_ranks_continue = pageRanksContinue;
    if (!pageItemsAssigned) failures.push(`rank/category/${sampleCategory.id}/page/2: contains unassigned repo`);
    if (!pageRanksContinue) failures.push(`rank/category/${sampleCategory.id}/page/2: rank[0] does not continue from page 1`);
  }

  return { invariants, failures };
}

export function inspectRank(
  label: string,
  rank: RankList,
  refs: { lookup?: ReposLookup; orgLookup?: OrgsLookup } = {},
): ValidationInvariantReport {
  const invariants: ValidationInvariants = {};
  const failures: string[] = [];
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
  return { invariants, failures };
}

function mergeReport(target: ValidationInvariantReport, report: ValidationInvariantReport) {
  Object.assign(target.invariants, report.invariants);
  target.failures.push(...report.failures);
}

function itemKey(item: RankItem): string | null {
  if (item.id != null) return `repo:${item.id}`;
  if (item.login != null) return `org:${item.login}`;
  return null;
}
