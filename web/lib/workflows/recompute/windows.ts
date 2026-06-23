// Per-window metric tables — pure-JS equivalents of precompute's rm_<w> / om_<w>.
// Seam-aware stock anchoring (RANKING §3): pre-seam periods (≤ model.seam[w]) use
// round(cumGross × frozen d) so the curve endpoint lands on current_stars@seam; post-seam
// periods add net on top of that frozen anchor (net is not scaled by d). While all canonical
// data is pre-seam the post-seam branch is inert, so output is unchanged. Org stock
// forward-fills idle periods so the org curve endpoint sums to current_stars_sum (RANKING §5).

import { byPeriod, type Model, type Period } from "./model";

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

type PeriodCell = { id: number; flow: number; cumgross: number; stock_est: number };

/** Assign per-period flow_rank (flow desc, cumgross desc, repo_id asc — matches rm_<w>.flow_rank). */
function finalizeWindow(byRepo: Map<number, RepoRow[]>, rowsByPeriod: Map<Period, PeriodCell[]>): RepoWindow {
  const rankIndex = new Map<Period, Map<number, number>>();
  for (const [period, bucket] of rowsByPeriod) {
    const ordered = [...bucket].sort((a, b) => b.flow - a.flow || b.cumgross - a.cumgross || a.id - b.id);
    const idx = new Map<number, number>();
    ordered.forEach((row, i) => idx.set(row.id, i + 1));
    rankIndex.set(period, idx);
  }
  for (const [id, rows] of byRepo) for (const row of rows) row.flow_rank = rankIndex.get(row.period)!.get(id)!;
  return { byRepo, rowsByPeriod, periods: [...rowsByPeriod.keys()].sort(byPeriod) };
}

/** Month/week repo window. Seam-aware stock: pre-seam periods (≤ model.seam[w]) accumulate gross
 *  and stock = round(cumGross × d); post-seam periods add net on top of the frozen seam anchor
 *  round(cumGross@seam × d) — net is not scaled by d (RANKING §3). `cumgross` is the running total
 *  used only as the flow_rank tiebreak; it equals the gross cumsum while all data is pre-seam. */
export function computeRepoWindow(model: Model, w: "month" | "week"): RepoWindow {
  const seamPeriod = model.seam[w];
  const byRepo = new Map<number, RepoRow[]>();
  const rowsByPeriod = new Map<Period, PeriodCell[]>();

  for (const id of model.ids) {
    const series = w === "week" ? model.weekly.get(id) ?? [] : model.monthly.get(id) ?? [];
    if (series.length === 0) {
      byRepo.set(id, []);
      continue;
    }
    const d = model.repos.get(id)?.d ?? 0;
    let cumGross = 0;
    let cumNet = 0;
    let anchor: number | null = null; // round(cumGross@seam × d), frozen at the first post-seam period
    const rows: RepoRow[] = [];
    for (const [period, flow] of series) {
      let stock_est: number;
      if (period <= seamPeriod) {
        cumGross += flow;
        stock_est = Math.round(cumGross * d);
      } else {
        if (anchor === null) anchor = Math.round(cumGross * d);
        cumNet += flow;
        stock_est = anchor + cumNet;
      }
      const cumgross = cumGross + cumNet; // running total for the tiebreak (= cumGross pre-seam)
      rows.push({ period, flow, cumgross, stock_est, flow_rank: 0 });
      let bucket = rowsByPeriod.get(period);
      if (!bucket) rowsByPeriod.set(period, (bucket = []));
      bucket.push({ id, flow, cumgross, stock_est });
    }
    byRepo.set(id, rows);
  }
  return finalizeWindow(byRepo, rowsByPeriod);
}

/** Year repo window derived from the seam-aware monthly window: year flow = Σ months; year stock =
 *  the monthly stock at the year's last month (so the within-year seam split that monthly already
 *  resolves carries into the straddle year without re-deriving gross/net at year granularity). */
export function deriveYearWindow(model: Model, monthWin: RepoWindow): RepoWindow {
  const byRepo = new Map<number, RepoRow[]>();
  const rowsByPeriod = new Map<Period, PeriodCell[]>();

  for (const id of model.ids) {
    const mrows = monthWin.byRepo.get(id) ?? [];
    if (mrows.length === 0) {
      byRepo.set(id, []);
      continue;
    }
    const byYear = new Map<string, { flow: number; cumgross: number; stock_est: number }>();
    for (const r of mrows) {
      const y = r.period.slice(0, 4);
      const cur = byYear.get(y);
      if (!cur) byYear.set(y, { flow: r.flow, cumgross: r.cumgross, stock_est: r.stock_est });
      else {
        cur.flow += r.flow;
        cur.cumgross = r.cumgross; // last month of the year wins (mrows are period-asc)
        cur.stock_est = r.stock_est;
      }
    }
    const rows: RepoRow[] = [...byYear.entries()]
      .sort((a, b) => byPeriod(a[0], b[0]))
      .map(([period, v]) => ({ period, flow: v.flow, cumgross: v.cumgross, stock_est: v.stock_est, flow_rank: 0 }));
    byRepo.set(id, rows);
    for (const r of rows) {
      let bucket = rowsByPeriod.get(r.period);
      if (!bucket) rowsByPeriod.set(r.period, (bucket = []));
      bucket.push({ id: id, flow: r.flow, cumgross: r.cumgross, stock_est: r.stock_est });
    }
  }
  return finalizeWindow(byRepo, rowsByPeriod);
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
