// Rank matrix + derived rankings — pure-JS equivalent of precompute's exportRanks /
// exportAllTime / exportGrowth / exportNewcomers. Top-100 per period with prev_rank
// resolved against the *full* ranking of the previous period (RANKING §4).

import { type Model, type Period, type RepoMeta } from "./model";
import { GROWTH_FLOOR_STARS } from "@/lib/constants";
import type { OrgWindow, RepoWindow, Window } from "./windows";

const TOP_N = 100;

export interface RankView {
  meta: { window: string; period: string; dim: string; metric: string; generated_at: string };
  items: Array<Record<string, number | string | null>>;
}

interface Row {
  key: string; // entity identity for prev_rank join (id or login, stringified)
  id?: number;
  login?: string;
  val: number;
  other: number;
}

// Tie-break must match precompute's SQL: repo_id is BIGINT (numeric), org login is text.
const tieRepo = (a: Row, b: Row) => a.id! - b.id!;
const tieOrg = (a: Row, b: Row) => (a.login! < b.login! ? -1 : a.login! > b.login! ? 1 : 0);

/** Rank every period fully, then emit top-N with prev_rank from the prior period's full ranks. */
function rankByPeriod(
  periods: Period[],
  rowsByPeriod: Map<Period, Row[]>,
  meta: Omit<RankView["meta"], "period">,
  tie: (a: Row, b: Row) => number,
): Map<Period, RankView> {
  const fullRank = new Map<Period, Map<string, number>>();
  const ordered = new Map<Period, Row[]>();
  for (const period of periods) {
    const rows = [...(rowsByPeriod.get(period) ?? [])].sort(
      (a, b) => b.val - a.val || b.other - a.other || tie(a, b),
    );
    const idx = new Map<string, number>();
    rows.forEach((r, i) => idx.set(r.key, i + 1));
    fullRank.set(period, idx);
    ordered.set(period, rows);
  }

  const out = new Map<Period, RankView>();
  periods.forEach((period, pi) => {
    const prev = pi > 0 ? fullRank.get(periods[pi - 1]) : undefined;
    const items: RankView["items"] = [];
    const rows = ordered.get(period)!;
    for (let i = 0; i < rows.length && i < TOP_N; i++) {
      const r = rows[i];
      const prev_rank = prev?.get(r.key) ?? null;
      const item: Record<string, number | string | null> = { rank: i + 1, value: r.val, prev_rank };
      if (r.id !== undefined) item.id = r.id;
      else item.login = r.login!;
      items.push(item);
    }
    out.set(period, { meta: { ...meta, period }, items });
  });
  return out;
}

export function repoRankMatrix(rw: RepoWindow, w: Window, gen: string): Map<string, RankView> {
  const out = new Map<string, RankView>();
  for (const metric of ["flow", "stock"] as const) {
    const rows = new Map<Period, Row[]>();
    for (const [period, bucket] of rw.rowsByPeriod) {
      rows.set(
        period,
        bucket.map((b) => ({
          key: String(b.id),
          id: b.id,
          val: metric === "flow" ? b.flow : b.stock_est,
          other: metric === "flow" ? b.stock_est : b.flow,
        })),
      );
    }
    const meta = { window: w, dim: "repo", metric, generated_at: gen };
    for (const [period, view] of rankByPeriod(rw.periods, rows, meta, tieRepo))
      out.set(`rank/${w}/${period}/repo/${metric}.json`, view);
  }
  return out;
}

export function orgRankMatrix(ow: OrgWindow, w: Window, gen: string): Map<string, RankView> {
  const out = new Map<string, RankView>();
  for (const metric of ["flow", "stock"] as const) {
    const rows = new Map<Period, Row[]>();
    for (const [period, bucket] of ow.rowsByPeriod) {
      rows.set(
        period,
        bucket.map((b) => ({
          key: b.login,
          login: b.login,
          val: metric === "flow" ? b.flow : b.stock_est,
          other: metric === "flow" ? b.stock_est : b.flow,
        })),
      );
    }
    const meta = { window: w, dim: "org", metric, generated_at: gen };
    for (const [period, view] of rankByPeriod(ow.periods, rows, meta, tieOrg))
      out.set(`rank/${w}/${period}/org/${metric}.json`, view);
  }
  return out;
}

export function allTime(model: Model, gen: string): Map<string, RankView> {
  const repoItems = [...model.repos.values()]
    .sort((a, b) => b.current_stars - a.current_stars || a.id - b.id)
    .slice(0, TOP_N)
    .map((r, i) => ({ rank: i + 1, id: r.id, value: r.current_stars, prev_rank: null }));
  const orgItems = [...model.orgs.values()]
    .sort((a, b) => b.current_stars_sum - a.current_stars_sum || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))
    .slice(0, TOP_N)
    .map((o, i) => ({ rank: i + 1, login: o.login, value: o.current_stars_sum, prev_rank: null }));
  return new Map([
    ["rank/all-time/repo/stock.json", { meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: gen }, items: repoItems }],
    ["rank/all-time/org/stock.json", { meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: gen }, items: orgItems }],
  ]);
}

/** Growth = flow / prev-period stock_est, floor prev stock ≥ 20k (also dedupes newcomers). */
export function growth(rw: RepoWindow, w: Window, gen: string): Map<string, RankView> {
  const byPeriodRows = new Map<Period, Array<{ id: number; flow: number; base: number }>>();
  for (const [id, rows] of rw.byRepo) {
    for (let i = 1; i < rows.length; i++) {
      const base = rows[i - 1].stock_est;
      const flow = rows[i].flow;
      if (base < GROWTH_FLOOR_STARS || flow <= 0) continue;
      let bucket = byPeriodRows.get(rows[i].period);
      if (!bucket) byPeriodRows.set(rows[i].period, (bucket = []));
      bucket.push({ id, flow, base });
    }
  }
  const out = new Map<string, RankView>();
  for (const [period, bucket] of byPeriodRows) {
    const items = bucket
      .sort((a, b) => b.flow / b.base - a.flow / a.base || b.flow - a.flow || a.id - b.id)
      .slice(0, TOP_N)
      .map((r, i) => ({
        rank: i + 1,
        id: r.id,
        value: r.flow,
        base: r.base,
        rate: Math.round((r.flow / r.base) * 1000) / 10,
        prev_rank: null,
      }));
    out.set(`rank/${w}/${period}/repo/growth.json`, {
      meta: { window: w, period, dim: "repo", metric: "growth", generated_at: gen },
      items,
    });
  }
  return out;
}

/** Newcomers = repos whose stock first crossed 10k in this period (from milestone crossed_10k). */
export function newcomers(model: Model, w: "month" | "year", gen: string): Map<string, RankView> {
  const sliceLen = w === "month" ? 7 : 4;
  const byPeriodList = new Map<string, RepoMeta[]>();
  for (const r of model.repos.values()) {
    if (!r.crossed_10k) continue;
    const period = r.crossed_10k.slice(0, sliceLen);
    let list = byPeriodList.get(period);
    if (!list) byPeriodList.set(period, (list = []));
    list.push(r);
  }
  const out = new Map<string, RankView>();
  for (const [period, list] of byPeriodList) {
    const items = [...list]
      .sort((a, b) => b.current_stars - a.current_stars || a.id - b.id)
      .slice(0, TOP_N)
      .map((r, i) => ({ rank: i + 1, id: r.id, value: r.current_stars, date: r.crossed_10k!, prev_rank: null }));
    out.set(`rank/${w}/${period}/repo/new.json`, {
      meta: { window: w, period, dim: "repo", metric: "new", generated_at: gen },
      items,
    });
  }
  return out;
}
