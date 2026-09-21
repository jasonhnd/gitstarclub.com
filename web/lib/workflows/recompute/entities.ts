// Entity + lookup views — pure-JS equivalent of precompute's exportRepoEntities /
// exportOrgEntities / exportLookups. Repo entity = anchored monthly curve + recent
// daily tail + monthly table + rank history. Org entity = aggregated member curve.

import { OrgEntity as OrgEntitySchema, RepoEntity as RepoEntitySchema } from "@/lib/contracts";
import type { DailySeries, DateStr, Model, RepoMeta } from "./model";
import type { OrgRow, RepoRow, RepoWindow, OrgWindow } from "./windows";
import { detectInflections, type Inflection } from "./inflections";
import { truncateUnicodeText } from "@/lib/unicode-text";

const MONTHLY_TABLE_MONTHS = 24;

export interface RepoEntity {
  id: number;
  full_name: string;
  owner: string;
  owner_type: string;
  name: string;
  description: string | null;
  language: string | null;
  languages?: Array<{ name: string; size: number; color?: string | null }>;
  topics: string[];
  created_at: string;
  current_stars: number;
  active: boolean;
  tracked_since: string | null;
  is_archived: boolean;
  milestones: { crossed_10k: string | null; crossed_50k: string | null; crossed_100k: string | null };
  curve: { monthly: Array<[string, number, number]>; recent_daily: Array<[string, number]> };
  monthly_table: Array<{ month: string; adds: number; rank: number }>;
  rank_history: { month: Array<[string, number]> };
  inflections?: Inflection[];
}

export function repoEntityFromParts(
  meta: RepoMeta,
  mrows: RepoRow[],
  drows: DailySeries,
): { entity: RepoEntity; drift: number } {
  const last = mrows.at(-1);
  const drift = last ? Math.abs(last.stock_est - meta.current_stars) : 0;
  const entity: RepoEntity = {
    id: meta.id,
    full_name: meta.full_name,
    owner: meta.owner,
    owner_type: meta.owner_type,
    name: meta.name,
    description: meta.description ?? null,
    language: meta.language ?? null,
    languages: meta.languages ?? [],
    topics: meta.topics ?? [],
    created_at: (meta.created_at ?? "").slice(0, 10),
    current_stars: meta.current_stars,
    active: meta.active !== false,
    tracked_since: meta.tracked_since ?? null,
    is_archived: !!meta.is_archived,
    milestones: {
      crossed_10k: meta.crossed_10k ?? null,
      crossed_50k: meta.crossed_50k ?? null,
      crossed_100k: meta.crossed_100k ?? null,
    },
    curve: {
      monthly: mrows.map((r) => [r.period, r.flow, r.stock_est] as [string, number, number]),
      recent_daily: drows.map((r) => [r[0], r[1]] as [string, number]),
    },
    monthly_table: mrows.slice(-MONTHLY_TABLE_MONTHS).map((r) => ({ month: r.period, adds: r.flow, rank: r.flow_rank })),
    rank_history: { month: mrows.map((r) => [r.period, r.flow_rank] as [string, number]) },
  };
  const inflections = detectInflections(mrows.map((r) => [r.period, r.flow] as [string, number]));
  if (inflections.length) entity.inflections = inflections;
  const parsed = RepoEntitySchema.safeParse(entity);
  if (!parsed.success) {
    throw new Error(`entity/repo/${meta.id}.json failed RepoEntity parse: ${parsed.error.message}`);
  }
  return { entity: parsed.data as RepoEntity, drift };
}

/** entity/repo/<id>.json for every repo, plus the max stock-anchor drift for sanity. */
export function repoEntities(model: Model, monthWin: RepoWindow): { views: Map<string, RepoEntity>; anchorDrift: number } {
  const views = new Map<string, RepoEntity>();
  let anchorDrift = 0;
  for (const id of model.ids) {
    const built = repoEntityFromParts(model.repos.get(id)!, monthWin.byRepo.get(id) ?? [], model.recentDaily.get(id) ?? []);
    anchorDrift = Math.max(anchorDrift, built.drift);
    views.set(`entity/repo/${id}.json`, built.entity);
  }
  return { views, anchorDrift };
}

export interface OrgEntity {
  login: string;
  owner_type: string;
  current_stars_sum: number;
  repo_count: number;
  members: number[];
  curve: { monthly: Array<[string, number, number]>; recent_daily: Array<[string, number]> };
}

export function orgEntityFromParts(
  login: string,
  ownerType: string,
  currentStarsSum: number,
  repoCount: number,
  members: number[],
  mrows: OrgRow[],
  recentDaily: Array<[DateStr, number]>,
): { entity: OrgEntity; drift: number } {
  const last = mrows.at(-1);
  const drift = last ? Math.abs(last.stock_est - currentStarsSum) : 0;
  const entity = {
    login,
    owner_type: ownerType,
    current_stars_sum: currentStarsSum,
    repo_count: repoCount,
    members,
    curve: {
      monthly: mrows.map((r) => [r.period, r.flow, r.stock_est] as [string, number, number]),
      recent_daily: recentDaily,
    },
  };
  const parsed = OrgEntitySchema.safeParse(entity);
  if (!parsed.success) {
    throw new Error(`entity/org/${login}.json failed OrgEntity parse: ${parsed.error.message}`);
  }
  return { entity: parsed.data as OrgEntity, drift };
}

/** Org-level recent daily tail = sum of member deltas per day. */
function orgRecentDaily(model: Model, members: number[]): Array<[DateStr, number]> {
  const byDay = new Map<DateStr, number>();
  for (const id of members)
    for (const [d, delta] of model.recentDaily.get(id) ?? []) byDay.set(d, (byDay.get(d) ?? 0) + delta);
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function orgEntities(model: Model, monthOrg: OrgWindow): { views: Map<string, OrgEntity>; anchorDrift: number } {
  const views = new Map<string, OrgEntity>();
  let anchorDrift = 0;
  for (const [login, agg] of model.orgs) {
    const built = orgEntityFromParts(
      login,
      agg.owner_type,
      agg.current_stars_sum,
      agg.repo_count,
      agg.members,
      monthOrg.byLogin.get(login) ?? [],
      orgRecentDaily(model, agg.members),
    );
    anchorDrift = Math.max(anchorDrift, built.drift);
    views.set(`entity/org/${login}.json`, built.entity);
  }
  return { views, anchorDrift };
}

const SEARCH_DESC_CAP = 200; // bound the client-loaded index; keywords live in the description head

/** search/index.json — one lean doc per repo for the client-side MiniSearch index (§V0.2 §1).
 *  Derived from the same repos dimension as lookups; descriptions are head-capped to bound size. */
export function searchIndex(model: Model, gen: string): Map<string, unknown> {
  const repos = model.ids.map((id) => {
    const r = model.repos.get(id)!;
    const desc = truncateUnicodeText(r.description ?? "", SEARCH_DESC_CAP);
    return {
      id: r.id,
      full_name: r.full_name,
      owner: r.owner,
      language: r.language ?? null,
      current_stars: r.current_stars,
      description: desc || null,
      active: r.active !== false,
      tracked_since: r.tracked_since ?? null,
    };
  });
  return new Map<string, unknown>([["search/index.json", { generated_at: gen, count: repos.length, repos }]]);
}

export function lookups(model: Model): Map<string, unknown> {
  const repoLk: Record<string, unknown> = {};
  for (const r of model.repos.values())
    repoLk[r.id] = {
      owner: r.owner,
      name: r.name,
      full_name: r.full_name,
      owner_type: r.owner_type,
      language: r.language ?? null,
      current_stars: r.current_stars,
      active: r.active !== false,
      tracked_since: r.tracked_since ?? null,
    };
  const orgLk: Record<string, unknown> = {};
  for (const o of model.orgs.values())
    orgLk[o.login] = { login: o.login, owner_type: o.owner_type, repo_count: o.repo_count, current_stars_sum: o.current_stars_sum };
  return new Map<string, unknown>([
    ["lookup/repos.json", repoLk],
    ["lookup/orgs.json", orgLk],
  ]);
}
