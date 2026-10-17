import { classifyActiveRepo } from "./categories";
import { lookupOrgEntry, lookupRepoEntry, searchRepoDoc } from "./entities";
import type { OwnerType, RepoMeta } from "./model";
import { RANK_TOP_N, type RankView } from "./ranks";
import type { CategoryAssignment } from "@/lib/categories/rules";

// Rest recompute must not load every repo into one Model. Each hop folds one
// canonical repos bucket into a bounded carry plus a partial file.

export type RestTopRepo = { id: number; stars: number };
export type RestNewcomer = { id: number; stars: number; date: string };
export type RestOrg = {
  login: string;
  owner_type: OwnerType;
  repo_count: number;
  current_stars_sum: number;
  /** Lowest member repo id. owner_type follows that row, matching assembleModel insertion order. */
  anchorId: number;
};

export type RestCarry = {
  v: 1;
  generatedAt: string;
  repoTop: RestTopRepo[];
  orgs: RestOrg[];
  newcomersMonth: Record<string, RestNewcomer[]>;
  newcomersYear: Record<string, RestNewcomer[]>;
  /** Buckets already folded. A queue retry must not add the same repos twice. */
  doneBuckets: number[];
};

export type RestBucketPartial = {
  v: 1;
  lookup: Record<string, ReturnType<typeof lookupRepoEntry>>;
  search: Array<ReturnType<typeof searchRepoDoc>>;
  active: Array<{ id: number; stars: number; categories: string[]; assignment: CategoryAssignment }>;
  languageLabels: Record<string, string>;
  assignments: Record<string, CategoryAssignment>;
};

function byStarsThenId(left: { id: number; stars: number }, right: { id: number; stars: number }): number {
  return right.stars - left.stars || left.id - right.id;
}

function keepTop<T extends { id: number; stars: number }>(rows: T[], topN = RANK_TOP_N): T[] {
  return [...rows].sort(byStarsThenId).slice(0, topN);
}

function considerTop<T extends { id: number; stars: number }>(current: T[], row: T, topN = RANK_TOP_N): T[] {
  const next = [...current, row];
  next.sort(byStarsThenId);
  if (next.length > topN) next.length = topN;
  return next;
}

export function emptyRestCarry(generatedAt: string): RestCarry {
  return {
    v: 1,
    generatedAt,
    repoTop: [],
    orgs: [],
    newcomersMonth: {},
    newcomersYear: {},
    doneBuckets: [],
  };
}

export function foldRestBucket(carry: RestCarry, repos: Iterable<RepoMeta>): RestBucketPartial {
  const orgs = new Map(carry.orgs.map((org) => [org.login, { ...org }]));
  const partial: RestBucketPartial = { v: 1, lookup: {}, search: [], active: [], languageLabels: {}, assignments: {} };
  const ordered = [...repos].sort((left, right) => left.id - right.id);
  for (const repo of ordered) {
    partial.lookup[String(repo.id)] = lookupRepoEntry(repo);
    partial.search.push(searchRepoDoc(repo));
    if (repo.crossed_10k) {
      const month = repo.crossed_10k.slice(0, 7);
      const year = repo.crossed_10k.slice(0, 4);
      const row = { id: repo.id, stars: repo.current_stars, date: repo.crossed_10k };
      carry.newcomersMonth[month] = considerTop(carry.newcomersMonth[month] ?? [], row);
      carry.newcomersYear[year] = considerTop(carry.newcomersYear[year] ?? [], row);
    }
    if (repo.active === false) continue;
    carry.repoTop = considerTop(carry.repoTop, { id: repo.id, stars: repo.current_stars });
    let org = orgs.get(repo.owner);
    if (!org) {
      org = { login: repo.owner, owner_type: repo.owner_type, repo_count: 0, current_stars_sum: 0, anchorId: repo.id };
      orgs.set(repo.owner, org);
    } else if (repo.id < org.anchorId) {
      org.owner_type = repo.owner_type;
      org.anchorId = repo.id;
    }
    org.repo_count += 1;
    org.current_stars_sum += repo.current_stars;
    const classified = classifyActiveRepo(repo, carry.generatedAt);
    if (!classified) continue;
    for (const label of classified.languageLabels) partial.languageLabels[label.slug] = label.label;
    partial.active.push({ id: repo.id, stars: repo.current_stars, categories: classified.categoryIds, assignment: classified.assignment });
    partial.assignments[String(repo.id)] = classified.assignment;
  }
  carry.orgs = [...orgs.values()].sort((left, right) => (left.login < right.login ? -1 : left.login > right.login ? 1 : 0));
  return partial;
}

export function allTimeViewsFromCarry(carry: RestCarry): Map<string, RankView> {
  const repoItems = keepTop(carry.repoTop).map((row, index) => ({
    rank: index + 1,
    id: row.id,
    value: row.stars,
    prev_rank: null,
  }));
  const orgItems = [...carry.orgs]
    .sort((left, right) => right.current_stars_sum - left.current_stars_sum || (left.login < right.login ? -1 : left.login > right.login ? 1 : 0))
    .slice(0, RANK_TOP_N)
    .map((org, index) => ({ rank: index + 1, login: org.login, value: org.current_stars_sum, prev_rank: null }));
  return new Map([
    [
      "rank/all-time/repo/stock.json",
      { meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: carry.generatedAt }, items: repoItems },
    ],
    [
      "rank/all-time/org/stock.json",
      { meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: carry.generatedAt }, items: orgItems },
    ],
  ]);
}

export function newcomerViewsFromCarry(carry: RestCarry): Map<string, RankView> {
  const out = new Map<string, RankView>();
  const write = (w: "month" | "year", groups: Record<string, RestNewcomer[]>) => {
    for (const [period, list] of Object.entries(groups)) {
      const items = keepTop(list).map((row, index) => ({
        rank: index + 1,
        id: row.id,
        value: row.stars,
        date: row.date,
        prev_rank: null,
      }));
      out.set(`rank/${w}/${period}/repo/new.json`, {
        meta: { window: w, period, dim: "repo", metric: "new", generated_at: carry.generatedAt },
        items,
      });
    }
  };
  write("month", carry.newcomersMonth);
  write("year", carry.newcomersYear);
  return out;
}

export function orgLookupFromCarry(carry: RestCarry): Record<string, ReturnType<typeof lookupOrgEntry>> {
  const orgLk: Record<string, ReturnType<typeof lookupOrgEntry>> = {};
  for (const org of carry.orgs) orgLk[org.login] = lookupOrgEntry(org);
  return orgLk;
}

export function repoLookupFromPartials(partials: readonly RestBucketPartial[]): Record<string, ReturnType<typeof lookupRepoEntry>> {
  const lookup: Record<string, ReturnType<typeof lookupRepoEntry>> = {};
  for (const partial of partials) Object.assign(lookup, partial.lookup);
  return lookup;
}

export function searchIndexFromPartials(partials: readonly RestBucketPartial[], generatedAt: string) {
  const repos = partials.flatMap((partial) => partial.search).sort((left, right) => left.id - right.id);
  return { generated_at: generatedAt, count: repos.length, repos };
}

export function categoryAggregatesFromPartials(partials: readonly RestBucketPartial[]): {
  counts: Map<string, number>;
  languageLabels: Map<string, string>;
  members: Map<string, Array<{ id: number; stars: number }>>;
} {
  const counts = new Map<string, number>();
  const languageLabels = new Map<string, string>();
  const members = new Map<string, Array<{ id: number; stars: number }>>();
  for (const partial of partials) {
    for (const [slug, label] of Object.entries(partial.languageLabels)) languageLabels.set(slug, label);
    for (const row of partial.active) {
      for (const category of row.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
        let list = members.get(category);
        if (!list) members.set(category, (list = []));
        list.push({ id: row.id, stars: row.stars });
      }
    }
  }
  return { counts, languageLabels, members };
}
