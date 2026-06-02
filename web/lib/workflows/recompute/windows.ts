// Per-window metric tables — pure-JS equivalents of precompute's rm_<w> / om_<w>.
// Stock anchoring: stock_est = round(cumgross × frozen d) (RANKING §3); the curve's
// endpoint lands on current_stars. Org stock forward-fills idle periods so the org
// curve stays monotone and its endpoint sums to current_stars_sum (RANKING §5).

import { byPeriod, type Model, type Period, type Series } from "./model";

export type Window = "month" | "week" | "year";

export interface RepoRow {
  period: Period;
  flow: number;
  cumgross: number;
  stock_est: number;
  flow_rank: number; // per-period rank by (flow desc, cumgross desc, id asc)
}

export interface RepoWindow {
  byRepo: Map<number, RepoRow[]>; // period-asc, flow_rank filled
  rowsByPeriod: Map<Period, Array<{ id: number; flow: number; cumgross: number; stock_est: number }>>;
  periods: Period[]; // sorted asc
}

export interface OrgRow {
  period: Period;
  flow: number;
  stock_est: number;
}

export interface OrgWindow {
  byLogin: Map<string, OrgRow[]>;
  rowsByPeriod: Map<Period, Array<{ login: string; flow: number; stock_est: number }>>;
  periods: Period[];
}

/** Yearly series derived from monthly: year flow = Σ months; cumgross identical at year end. */
function yearlySeries(monthly: Series): Series {
  const byYear = new Map<string, number>();
  for (const [period, flow] of monthly) {
    const y = period.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + flow);
  }
  return [...byYear.entries()].sort((a, b) => byPeriod(a[0], b[0]));
}

function seriesFor(model: Model, w: Window, id: number): Series {
  if (w === "week") return model.weekly.get(id) ?? [];
  const monthly = model.monthly.get(id) ?? [];
  return w === "month" ? monthly : yearlySeries(monthly);
}

export function computeRepoWindow(model: Model, w: Window): RepoWindow {
  const byRepo = new Map<number, RepoRow[]>();
  const rowsByPeriod = new Map<Period, Array<{ id: number; flow: number; cumgross: number; stock_est: number }>>();

  for (const id of model.ids) {
    const series = seriesFor(model, w, id);
    if (series.length === 0) {
      byRepo.set(id, []);
      continue;
    }
    const d = model.repos.get(id)?.d ?? 0;
    let cum = 0;
    const rows: RepoRow[] = [];
    for (const [period, flow] of series) {
      cum += flow;
      const stock_est = Math.round(cum * d);
      rows.push({ period, flow, cumgross: cum, stock_est, flow_rank: 0 });
      let bucket = rowsByPeriod.get(period);
      if (!bucket) rowsByPeriod.set(period, (bucket = []));
      bucket.push({ id, flow, cumgross: cum, stock_est });
    }
    byRepo.set(id, rows);
  }

  // flow_rank per period: flow desc, cumgross desc, repo_id asc (matches rm_<w>.flow_rank).
  const rankIndex = new Map<Period, Map<number, number>>();
  for (const [period, bucket] of rowsByPeriod) {
    const ordered = [...bucket].sort(
      (a, b) => b.flow - a.flow || b.cumgross - a.cumgross || a.id - b.id,
    );
    const idx = new Map<number, number>();
    ordered.forEach((row, i) => idx.set(row.id, i + 1));
    rankIndex.set(period, idx);
  }
  for (const [id, rows] of byRepo)
    for (const row of rows) row.flow_rank = rankIndex.get(row.period)!.get(id)!;

  const periods = [...rowsByPeriod.keys()].sort(byPeriod);
  return { byRepo, rowsByPeriod, periods };
}

/** Org window: forward-fill each member's stock across idle periods, then sum per owner. */
export function computeOrgWindow(model: Model, repoWindow: RepoWindow): OrgWindow {
  const globalPeriods = repoWindow.periods; // sorted asc
  const periodIndex = new Map<Period, number>();
  globalPeriods.forEach((p, i) => periodIndex.set(p, i));

  // accumulator: login -> period -> { flow, stock }
  const acc = new Map<string, Map<Period, { flow: number; stock_est: number }>>();
  const ownerOf = (id: number) => model.repos.get(id)!.owner;

  for (const [id, rows] of repoWindow.byRepo) {
    if (rows.length === 0) continue;
    const login = ownerOf(id);
    let bucket = acc.get(login);
    if (!bucket) acc.set(login, (bucket = new Map()));

    const firstIdx = periodIndex.get(rows[0].period)!;
    const rowByPeriod = new Map<Period, RepoRow>();
    for (const r of rows) rowByPeriod.set(r.period, r);

    // walk every global period from this member's first appearance onward, carrying stock.
    let carry = 0;
    for (let i = firstIdx; i < globalPeriods.length; i++) {
      const period = globalPeriods[i];
      const own = rowByPeriod.get(period);
      const flow = own ? own.flow : 0;
      if (own) carry = own.stock_est; // refresh on real rows; else keep carry
      const cell = bucket.get(period);
      if (cell) {
        cell.flow += flow;
        cell.stock_est += carry;
      } else {
        bucket.set(period, { flow, stock_est: carry });
      }
    }
  }

  const byLogin = new Map<string, OrgRow[]>();
  const rowsByPeriod = new Map<Period, Array<{ login: string; flow: number; stock_est: number }>>();
  for (const [login, bucket] of acc) {
    const rows: OrgRow[] = [...bucket.entries()]
      .sort((a, b) => byPeriod(a[0], b[0]))
      .map(([period, v]) => ({ period, flow: v.flow, stock_est: v.stock_est }));
    byLogin.set(login, rows);
    for (const r of rows) {
      let pb = rowsByPeriod.get(r.period);
      if (!pb) rowsByPeriod.set(r.period, (pb = []));
      pb.push({ login, flow: r.flow, stock_est: r.stock_est });
    }
  }
  return { byLogin, rowsByPeriod, periods: globalPeriods };
}
