// Entity + lookup views — pure-JS equivalent of precompute's exportRepoEntities /
// exportOrgEntities / exportLookups. Repo entity = anchored monthly curve + recent
// daily tail + monthly table + rank history. Org entity = aggregated member curve.

import type { DateStr, Model } from "./model";
import type { RepoWindow, OrgWindow } from "./windows";

const MONTHLY_TABLE_MONTHS = 24;

export interface RepoEntity {
  id: number;
  full_name: string;
  owner: string;
  owner_type: string;
  name: string;
  description: string | null;
  language: string | null;
  topics: string[];
  created_at: string;
  current_stars: number;
  is_archived: boolean;
  milestones: { crossed_10k: string | null; crossed_50k: string | null; crossed_100k: string | null };
  curve: { monthly: Array<[string, number, number]>; recent_daily: Array<[string, number]> };
  monthly_table: Array<{ month: string; adds: number; rank: number }>;
  rank_history: { month: Array<[string, number]> };
}

/** entity/repo/<id>.json for every repo, plus the max stock-anchor drift for sanity. */
export function repoEntities(model: Model, monthWin: RepoWindow): { views: Map<string, RepoEntity>; anchorDrift: number } {
  const views = new Map<string, RepoEntity>();
  let anchorDrift = 0;
  for (const id of model.ids) {
    const meta = model.repos.get(id)!;
    const mrows = monthWin.byRepo.get(id) ?? [];
    const drows = model.recentDaily.get(id) ?? [];
    const last = mrows.at(-1);
    if (last) anchorDrift = Math.max(anchorDrift, Math.abs(last.stock_est - meta.current_stars));
    views.set(`entity/repo/${id}.json`, {
      id,
      full_name: meta.full_name,
      owner: meta.owner,
      owner_type: meta.owner_type,
      name: meta.name,
      description: meta.description ?? null,
      language: meta.language ?? null,
      topics: meta.topics ?? [],
      created_at: (meta.created_at ?? "").slice(0, 10),
      current_stars: meta.current_stars,
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
    });
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
    const mrows = monthOrg.byLogin.get(login) ?? [];
    const last = mrows.at(-1);
    if (last) anchorDrift = Math.max(anchorDrift, Math.abs(last.stock_est - agg.current_stars_sum));
    views.set(`entity/org/${login}.json`, {
      login,
      owner_type: agg.owner_type,
      current_stars_sum: agg.current_stars_sum,
      repo_count: agg.repo_count,
      members: agg.members,
      curve: {
        monthly: mrows.map((r) => [r.period, r.flow, r.stock_est] as [string, number, number]),
        recent_daily: orgRecentDaily(model, agg.members).map((r) => [r[0], r[1]] as [string, number]),
      },
    });
  }
  return { views, anchorDrift };
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
    };
  const orgLk: Record<string, unknown> = {};
  for (const o of model.orgs.values())
    orgLk[o.login] = { login: o.login, owner_type: o.owner_type, repo_count: o.repo_count, current_stars_sum: o.current_stars_sum };
  return new Map<string, unknown>([
    ["lookup/repos.json", repoLk],
    ["lookup/orgs.json", orgLk],
  ]);
}
