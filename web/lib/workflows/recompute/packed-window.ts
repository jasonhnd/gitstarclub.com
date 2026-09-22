import { GROWTH_FLOOR_STARS } from "@/lib/constants";
import { RANK_TOP_N, type RankView } from "./ranks";
import type { Period, Series } from "./model";
import {
  advanceSeamStock,
  createSeamStockAcc,
  type RepoRow,
  type Window,
} from "./windows";

// Compact typed repo window for CF recompute hops. Object RepoWindow
// (byRepo + rowsByPeriod) is ~every repo × every period as heap objects and
// is what still OOM'd the #486 month hop after weekly was split off.
// See docs/CF-MIGRATION-P1.md.

export type PackedRepoWindow = {
  ids: number[];
  owners: string[];
  active: Uint8Array;
  periods: string[];
  start: Uint32Array;
  len: Uint16Array;
  periodIdx: Uint16Array;
  flow: Float64Array;
  cumgross: Float64Array;
  stock: Float64Array;
};

export type PackedPeriodRepoRow = {
  id: number;
  flow: number;
  cumgross: number;
  stock_est: number;
};

export type PackedPeriodOrgRow = {
  login: string;
  flow: number;
  stock_est: number;
};

export type PackedWindowKind = "month" | "week" | "year";

export type PackedWindowMetaFile = {
  v: 1;
  kind: PackedWindowKind;
  seamPeriod: string;
  periods: string[];
  buckets: number;
  complete: true;
};

export type PackedWindowBucketRepo = {
  id: number;
  owner: string;
  active: boolean;
  cells: Array<readonly [number, number, number, number]>;
};

export type PackedWindowBucketFileV1 = {
  v: 1;
  repos: PackedWindowBucketRepo[];
};

/** Flat typed-array JSON. One week-win v1 bucket is ~every repo × every week as nested
 *  `[periodIdx, flow, cum, stock]` arrays; assembling 32 of those is the #497 week-start OOM. */
export type PackedWindowBucketFileV2 = {
  v: 2;
  ids: number[];
  owners: string[];
  active: number[];
  start: number[];
  len: number[];
  periodIdx: number[];
  flow: number[];
  cumgross: number[];
  stock: number[];
};

export type PackedWindowBucketFile = PackedWindowBucketFileV1 | PackedWindowBucketFileV2;

type RankRow = {
  key: string;
  id?: number;
  login?: string;
  val: number;
  other: number;
};

export type PackedWindowBuilder = {
  absorb(id: number, owner: string, active: boolean, d: number, series: Series): void;
  finalize(): PackedRepoWindow;
};

function growCapacity<T extends Uint16Array | Uint32Array | Float64Array>(
  current: T,
  cap: number,
  factory: (size: number) => T,
): T {
  const next = factory(cap);
  next.set(current as unknown as ArrayLike<number>);
  return next;
}

export function createPackedWindowBuilder(seamPeriod: Period, knownPeriods?: readonly string[]): PackedWindowBuilder {
  const intern = new Map<string, number>();
  const periods: string[] = [];
  const ids: number[] = [];
  const owners: string[] = [];
  const active: number[] = [];
  const starts: number[] = [];
  const lens: number[] = [];
  let cap = 1024;
  let n = 0;
  let periodIdx = new Uint16Array(cap);
  let flow = new Float64Array(cap);
  let cumgross = new Float64Array(cap);
  let stock = new Float64Array(cap);

  const internPeriod = (period: string): number => {
    const existing = intern.get(period);
    if (existing !== undefined) return existing;
    const idx = periods.length;
    if (idx > 0xffff) throw new Error("packed window exceeded 65535 distinct periods");
    intern.set(period, idx);
    periods.push(period);
    return idx;
  };

  if (knownPeriods) {
    for (const period of knownPeriods) internPeriod(period);
  }

  const grow = () => {
    cap *= 2;
    periodIdx = growCapacity(periodIdx, cap, (size) => new Uint16Array(size));
    flow = growCapacity(flow, cap, (size) => new Float64Array(size));
    cumgross = growCapacity(cumgross, cap, (size) => new Float64Array(size));
    stock = growCapacity(stock, cap, (size) => new Float64Array(size));
  };

  return {
    absorb(id, owner, isActive, d, series) {
      const acc = createSeamStockAcc();
      const start = n;
      for (const cell of series) {
        const period = cell[0];
        const cellFlow = cell[1];
        if (typeof period !== "string" || typeof cellFlow !== "number") continue;
        const stepped = advanceSeamStock(period, cellFlow, seamPeriod, d, acc);
        if (n >= cap) grow();
        periodIdx[n] = internPeriod(period);
        flow[n] = cellFlow;
        cumgross[n] = stepped.cumgross;
        stock[n] = stepped.stock_est;
        n += 1;
      }
      if (n - start > 0xffff) throw new Error(`packed window repo ${id} exceeded 65535 cells`);
      ids.push(id);
      owners.push(owner);
      active.push(isActive ? 1 : 0);
      starts.push(start);
      lens.push(n - start);
    },
    finalize() {
      const order = periods.map((_, index) => index).sort((left, right) => {
        const a = periods[left]!;
        const b = periods[right]!;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const remap = new Uint16Array(periods.length);
      const sorted = order.map((old) => periods[old]!);
      order.forEach((old, neu) => {
        remap[old] = neu;
      });
      const packedPeriodIdx = new Uint16Array(n);
      const packedFlow = new Float64Array(n);
      const packedCum = new Float64Array(n);
      const packedStock = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        packedPeriodIdx[i] = remap[periodIdx[i]!]!;
        packedFlow[i] = flow[i]!;
        packedCum[i] = cumgross[i]!;
        packedStock[i] = stock[i]!;
      }
      return {
        ids,
        owners,
        active: Uint8Array.from(active),
        periods: sorted,
        start: Uint32Array.from(starts),
        len: Uint16Array.from(lens),
        periodIdx: packedPeriodIdx,
        flow: packedFlow,
        cumgross: packedCum,
        stock: packedStock,
      };
    },
  };
}

export function findPackedCell(packed: PackedRepoWindow, start: number, end: number, periodIndex: number): number {
  let lo = start;
  let hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = packed.periodIdx[mid]!;
    if (value === periodIndex) return mid;
    if (value < periodIndex) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export function packedRepoPeriodRows(packed: PackedRepoWindow, periodIndex: number): PackedPeriodRepoRow[] {
  const rows: PackedPeriodRepoRow[] = [];
  for (let repo = 0; repo < packed.ids.length; repo++) {
    const start = packed.start[repo]!;
    const end = start + packed.len[repo]!;
    if (end <= start) continue;
    const cell = findPackedCell(packed, start, end, periodIndex);
    if (cell < 0) continue;
    rows.push({
      id: packed.ids[repo]!,
      flow: packed.flow[cell]!,
      cumgross: packed.cumgross[cell]!,
      stock_est: packed.stock[cell]!,
    });
  }
  return rows;
}

export function forEachPackedBucketRepo(
  shard: PackedWindowBucketFile,
  visit: (repo: {
    id: number;
    owner: string;
    active: boolean;
    firstPeriod: number;
    cells: Iterable<readonly [number, number, number, number]>;
  }) => void,
): void {
  if (shard.v === 1) {
    for (const repo of shard.repos) {
      visit({
        id: repo.id,
        owner: repo.owner,
        active: repo.active,
        firstPeriod: repo.cells[0]?.[0] ?? Number.POSITIVE_INFINITY,
        cells: repo.cells,
      });
    }
    return;
  }
  for (let repo = 0; repo < shard.ids.length; repo++) {
    const start = shard.start[repo]!;
    const len = shard.len[repo]!;
    visit({
      id: shard.ids[repo]!,
      owner: shard.owners[repo]!,
      active: shard.active[repo] === 1,
      firstPeriod: len > 0 ? shard.periodIdx[start]! : Number.POSITIVE_INFINITY,
      cells: {
        *[Symbol.iterator]() {
          for (let cell = start; cell < start + len; cell++) {
            yield [shard.periodIdx[cell]!, shard.flow[cell]!, shard.cumgross[cell]!, shard.stock[cell]!];
          }
        },
      },
    });
  }
}

export function appendRepoPeriodRowsFromBucket(
  shard: PackedWindowBucketFile,
  periodFrom: number,
  periodTo: number,
  into: PackedPeriodRepoRow[][],
): void {
  forEachPackedBucketRepo(shard, (repo) => {
    for (const cell of repo.cells) {
      const periodIndex = cell[0];
      if (periodIndex < periodFrom || periodIndex >= periodTo) continue;
      into[periodIndex - periodFrom]!.push({
        id: repo.id,
        flow: cell[1],
        cumgross: cell[2],
        stock_est: cell[3],
      });
    }
  });
}

export function absorbOrgPeriodRowsFromBucket(
  shard: PackedWindowBucketFile,
  periodFrom: number,
  periodTo: number,
  carry: Map<number, number>,
  into: Array<Map<string, { flow: number; stock_est: number }>>,
): void {
  forEachPackedBucketRepo(shard, (repo) => {
    const present = new Map<number, readonly [number, number, number, number]>();
    for (const cell of repo.cells) present.set(cell[0], cell);
    for (let periodIndex = periodFrom; periodIndex < periodTo; periodIndex++) {
      if (periodIndex < repo.firstPeriod) continue;
      const cell = present.get(periodIndex);
      const flow = cell ? cell[1] : 0;
      if (cell) carry.set(repo.id, cell[3]);
      const stock = carry.get(repo.id) ?? 0;
      const slot = into[periodIndex - periodFrom]!;
      const cur = slot.get(repo.owner);
      if (cur) {
        cur.flow += flow;
        cur.stock_est += stock;
      } else {
        slot.set(repo.owner, { flow, stock_est: stock });
      }
    }
  });
}

export function orgRowsFromAbsorbed(acc: Map<string, { flow: number; stock_est: number }>): PackedPeriodOrgRow[] {
  const rows: PackedPeriodOrgRow[] = [];
  for (const [login, value] of acc) rows.push({ login, flow: value.flow, stock_est: value.stock_est });
  return rows;
}

export function packedOrgPeriodRows(
  packed: PackedRepoWindow,
  periodIndex: number,
  carry: Float64Array,
  options: { activeOnly?: boolean } = {},
): PackedPeriodOrgRow[] {
  const acc = new Map<string, { flow: number; stock_est: number }>();
  for (let repo = 0; repo < packed.ids.length; repo++) {
    if (options.activeOnly && packed.active[repo] === 0) continue;
    const start = packed.start[repo]!;
    const len = packed.len[repo]!;
    if (len === 0) continue;
    const first = packed.periodIdx[start]!;
    if (periodIndex < first) continue;
    const cell = findPackedCell(packed, start, start + len, periodIndex);
    const flow = cell >= 0 ? packed.flow[cell]! : 0;
    if (cell >= 0) carry[repo] = packed.stock[cell]!;
    const login = packed.owners[repo]!;
    const cur = acc.get(login);
    if (cur) {
      cur.flow += flow;
      cur.stock_est += carry[repo]!;
    } else {
      acc.set(login, { flow, stock_est: carry[repo]! });
    }
  }
  const rows: PackedPeriodOrgRow[] = [];
  for (const [login, value] of acc) rows.push({ login, flow: value.flow, stock_est: value.stock_est });
  return rows;
}

export function derivePackedYearWindow(month: PackedRepoWindow): PackedRepoWindow {
  const intern = new Map<string, number>();
  const periods: string[] = [];
  const internYear = (year: string): number => {
    const existing = intern.get(year);
    if (existing !== undefined) return existing;
    const idx = periods.length;
    intern.set(year, idx);
    periods.push(year);
    return idx;
  };
  const ids = month.ids.slice();
  const owners = month.owners.slice();
  const active = new Uint8Array(month.active);
  const starts: number[] = [];
  const lens: number[] = [];
  let cap = Math.max(1024, month.ids.length * 8);
  let n = 0;
  let periodIdx = new Uint16Array(cap);
  let flow = new Float64Array(cap);
  let cumgross = new Float64Array(cap);
  let stock = new Float64Array(cap);
  const grow = () => {
    cap *= 2;
    periodIdx = growCapacity(periodIdx, cap, (size) => new Uint16Array(size));
    flow = growCapacity(flow, cap, (size) => new Float64Array(size));
    cumgross = growCapacity(cumgross, cap, (size) => new Float64Array(size));
    stock = growCapacity(stock, cap, (size) => new Float64Array(size));
  };

  for (let repo = 0; repo < month.ids.length; repo++) {
    const start = month.start[repo]!;
    const end = start + month.len[repo]!;
    const repoStart = n;
    if (end > start) {
      let year = month.periods[month.periodIdx[start]!]!.slice(0, 4);
      let yearFlow = 0;
      let yearCum = 0;
      let yearStock = 0;
      for (let cell = start; cell < end; cell++) {
        const period = month.periods[month.periodIdx[cell]!]!;
        const y = period.slice(0, 4);
        if (y !== year) {
          if (n >= cap) grow();
          periodIdx[n] = internYear(year);
          flow[n] = yearFlow;
          cumgross[n] = yearCum;
          stock[n] = yearStock;
          n += 1;
          year = y;
          yearFlow = 0;
        }
        yearFlow += month.flow[cell]!;
        yearCum = month.cumgross[cell]!;
        yearStock = month.stock[cell]!;
      }
      if (n >= cap) grow();
      periodIdx[n] = internYear(year);
      flow[n] = yearFlow;
      cumgross[n] = yearCum;
      stock[n] = yearStock;
      n += 1;
    }
    starts.push(repoStart);
    lens.push(n - repoStart);
  }

  const order = periods.map((_, index) => index).sort((left, right) => {
    const a = periods[left]!;
    const b = periods[right]!;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const remap = new Uint16Array(periods.length);
  const sorted = order.map((old) => periods[old]!);
  order.forEach((old, neu) => {
    remap[old] = neu;
  });
  const packedPeriodIdx = new Uint16Array(n);
  const packedFlow = new Float64Array(n);
  const packedCum = new Float64Array(n);
  const packedStock = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    packedPeriodIdx[i] = remap[periodIdx[i]!]!;
    packedFlow[i] = flow[i]!;
    packedCum[i] = cumgross[i]!;
    packedStock[i] = stock[i]!;
  }
  return {
    ids,
    owners,
    active,
    periods: sorted,
    start: Uint32Array.from(starts),
    len: Uint16Array.from(lens),
    periodIdx: packedPeriodIdx,
    flow: packedFlow,
    cumgross: packedCum,
    stock: packedStock,
  };
}

function tieRepo(left: RankRow, right: RankRow): number {
  return left.id! - right.id!;
}

function tieOrg(left: RankRow, right: RankRow): number {
  return left.login! < right.login! ? -1 : left.login! > right.login! ? 1 : 0;
}

function rankTopN(
  rows: RankRow[],
  tie: (left: RankRow, right: RankRow) => number,
  prev: Map<string, number> | undefined,
  meta: RankView["meta"],
): { view: RankView; fullRank: Map<string, number> } {
  const ordered = [...rows].sort((a, b) => b.val - a.val || b.other - a.other || tie(a, b));
  const fullRank = new Map<string, number>();
  ordered.forEach((row, index) => fullRank.set(row.key, index + 1));
  const items: RankView["items"] = [];
  for (let i = 0; i < ordered.length && i < RANK_TOP_N; i++) {
    const row = ordered[i]!;
    const item: Record<string, number | string | null> = {
      rank: i + 1,
      value: row.val,
      prev_rank: prev?.get(row.key) ?? null,
    };
    if (row.id !== undefined) item.id = row.id;
    else item.login = row.login!;
    items.push(item);
  }
  return { view: { meta, items }, fullRank };
}

export function repoRankViewsFromPeriodRows(
  period: string,
  rows: PackedPeriodRepoRow[],
  w: Window,
  gen: string,
  prevFlow: Map<string, number> | undefined,
  prevStock: Map<string, number> | undefined,
): {
  views: Map<string, RankView>;
  nextFlow: Map<string, number>;
  nextStock: Map<string, number>;
} {
  const flowRows: RankRow[] = rows.map((row) => ({
    key: String(row.id),
    id: row.id,
    val: row.flow,
    other: row.stock_est,
  }));
  const stockRows: RankRow[] = rows.map((row) => ({
    key: String(row.id),
    id: row.id,
    val: row.stock_est,
    other: row.flow,
  }));
  const flow = rankTopN(flowRows, tieRepo, prevFlow, {
    window: w,
    period,
    dim: "repo",
    metric: "flow",
    generated_at: gen,
  });
  const stock = rankTopN(stockRows, tieRepo, prevStock, {
    window: w,
    period,
    dim: "repo",
    metric: "stock",
    generated_at: gen,
  });
  return {
    views: new Map([
      [`rank/${w}/${period}/repo/flow.json`, flow.view],
      [`rank/${w}/${period}/repo/stock.json`, stock.view],
    ]),
    nextFlow: flow.fullRank,
    nextStock: stock.fullRank,
  };
}

export function packedRepoRankViewsForPeriod(
  packed: PackedRepoWindow,
  periodIndex: number,
  w: Window,
  gen: string,
  prevFlow: Map<string, number> | undefined,
  prevStock: Map<string, number> | undefined,
): {
  views: Map<string, RankView>;
  nextFlow: Map<string, number>;
  nextStock: Map<string, number>;
} {
  return repoRankViewsFromPeriodRows(
    packed.periods[periodIndex]!,
    packedRepoPeriodRows(packed, periodIndex),
    w,
    gen,
    prevFlow,
    prevStock,
  );
}

export function orgRankViewsFromPeriodRows(
  period: string,
  rows: PackedPeriodOrgRow[],
  w: Window,
  gen: string,
  prevFlow: Map<string, number> | undefined,
  prevStock: Map<string, number> | undefined,
): {
  views: Map<string, RankView>;
  nextFlow: Map<string, number>;
  nextStock: Map<string, number>;
} {
  const flowRows: RankRow[] = rows.map((row) => ({
    key: row.login,
    login: row.login,
    val: row.flow,
    other: row.stock_est,
  }));
  const stockRows: RankRow[] = rows.map((row) => ({
    key: row.login,
    login: row.login,
    val: row.stock_est,
    other: row.flow,
  }));
  const flow = rankTopN(flowRows, tieOrg, prevFlow, {
    window: w,
    period,
    dim: "org",
    metric: "flow",
    generated_at: gen,
  });
  const stock = rankTopN(stockRows, tieOrg, prevStock, {
    window: w,
    period,
    dim: "org",
    metric: "stock",
    generated_at: gen,
  });
  return {
    views: new Map([
      [`rank/${w}/${period}/org/flow.json`, flow.view],
      [`rank/${w}/${period}/org/stock.json`, stock.view],
    ]),
    nextFlow: flow.fullRank,
    nextStock: stock.fullRank,
  };
}

export function packedOrgRankViewsForPeriod(
  packed: PackedRepoWindow,
  periodIndex: number,
  w: Window,
  gen: string,
  carry: Float64Array,
  prevFlow: Map<string, number> | undefined,
  prevStock: Map<string, number> | undefined,
): {
  views: Map<string, RankView>;
  nextFlow: Map<string, number>;
  nextStock: Map<string, number>;
} {
  return orgRankViewsFromPeriodRows(
    packed.periods[periodIndex]!,
    packedOrgPeriodRows(packed, periodIndex, carry),
    w,
    gen,
    prevFlow,
    prevStock,
  );
}

export type GrowthCandidate = { id: number; flow: number; base: number };

export function compareGrowthCandidates(left: GrowthCandidate, right: GrowthCandidate): number {
  return right.flow / right.base - left.flow / left.base || right.flow - left.flow || left.id - right.id;
}

function growthViewItems(bucket: GrowthCandidate[]) {
  return [...bucket]
    .sort(compareGrowthCandidates)
    .slice(0, RANK_TOP_N)
    .map((row, index) => ({
      rank: index + 1,
      id: row.id,
      value: row.flow,
      base: row.base,
      rate: Math.round((row.flow / row.base) * 1000) / 10,
      prev_rank: null,
    }));
}

export function packedGrowthViews(packed: PackedRepoWindow, w: Window, gen: string): Map<string, RankView> {
  const byPeriod = new Map<string, GrowthCandidate[]>();
  for (let repo = 0; repo < packed.ids.length; repo++) {
    const start = packed.start[repo]!;
    const len = packed.len[repo]!;
    for (let i = 1; i < len; i++) {
      const base = packed.stock[start + i - 1]!;
      const cellFlow = packed.flow[start + i]!;
      if (base < GROWTH_FLOOR_STARS || cellFlow <= 0) continue;
      const period = packed.periods[packed.periodIdx[start + i]!]!;
      let bucket = byPeriod.get(period);
      if (!bucket) byPeriod.set(period, (bucket = []));
      bucket.push({ id: packed.ids[repo]!, flow: cellFlow, base });
    }
  }
  return growthViewsFromTopCandidates(byPeriod, w, gen);
}

/** Keep the global top-N growth rows while scanning one persist bucket at a time. */
export function absorbGrowthCandidates(
  shard: PackedWindowBucketFile,
  periods: readonly string[],
  into: Map<string, GrowthCandidate[]>,
  topN = RANK_TOP_N,
): void {
  forEachPackedBucketRepo(shard, (repo) => {
    let prevStock: number | undefined;
    let seen = 0;
    for (const cell of repo.cells) {
      if (seen > 0 && prevStock !== undefined && prevStock >= GROWTH_FLOOR_STARS && cell[1] > 0) {
        const period = periods[cell[0]];
        if (!period) throw new Error(`packed growth period index ${cell[0]} is outside ${periods.length} periods`);
        const list = into.get(period) ?? [];
        list.push({ id: repo.id, flow: cell[1], base: prevStock });
        list.sort(compareGrowthCandidates);
        if (list.length > topN) list.length = topN;
        into.set(period, list);
      }
      prevStock = cell[3];
      seen += 1;
    }
  });
}

export function growthViewsFromTopCandidates(
  byPeriod: Map<string, GrowthCandidate[]>,
  w: Window,
  gen: string,
): Map<string, RankView> {
  const out = new Map<string, RankView>();
  for (const [period, bucket] of byPeriod) {
    if (bucket.length === 0) continue;
    out.set(`rank/${w}/${period}/repo/growth.json`, {
      meta: { window: w, period, dim: "repo", metric: "growth", generated_at: gen },
      items: growthViewItems(bucket),
    });
  }
  return out;
}

export function yearPeriodsFromMonthPeriods(monthPeriods: readonly string[]): string[] {
  const seen = new Set<string>();
  const years: string[] = [];
  for (const period of monthPeriods) {
    const year = period.slice(0, 4);
    if (year.length !== 4 || seen.has(year)) continue;
    seen.add(year);
    years.push(year);
  }
  years.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return years;
}

/** Roll one month persist bucket into year cells. Period indices are global year indices. */
export function deriveYearBucketFromMonthBucket(
  shard: PackedWindowBucketFile,
  monthPeriods: readonly string[],
  yearPeriods: readonly string[],
): PackedWindowBucketFileV2 {
  const yearIndex = new Map(yearPeriods.map((year, index) => [year, index]));
  const ids: number[] = [];
  const owners: string[] = [];
  const active: number[] = [];
  const start: number[] = [];
  const len: number[] = [];
  const periodIdx: number[] = [];
  const flow: number[] = [];
  const cumgross: number[] = [];
  const stock: number[] = [];

  forEachPackedBucketRepo(shard, (repo) => {
    const repoStart = periodIdx.length;
    let year = "";
    let yearFlow = 0;
    let yearCum = 0;
    let yearStock = 0;
    let open = false;
    const flush = () => {
      if (!open) return;
      const idx = yearIndex.get(year);
      if (idx === undefined) throw new Error(`year ${year} missing from derived year periods`);
      periodIdx.push(idx);
      flow.push(yearFlow);
      cumgross.push(yearCum);
      stock.push(yearStock);
      open = false;
    };
    for (const cell of repo.cells) {
      const period = monthPeriods[cell[0]];
      if (!period) throw new Error(`month period index ${cell[0]} is outside ${monthPeriods.length} periods`);
      const nextYear = period.slice(0, 4);
      if (!open) {
        year = nextYear;
        yearFlow = 0;
        open = true;
      } else if (nextYear !== year) {
        flush();
        year = nextYear;
        yearFlow = 0;
        open = true;
      }
      yearFlow += cell[1];
      yearCum = cell[2];
      yearStock = cell[3];
    }
    flush();
    ids.push(repo.id);
    owners.push(repo.owner);
    active.push(repo.active ? 1 : 0);
    start.push(repoStart);
    len.push(periodIdx.length - repoStart);
  });

  return { v: 2, ids, owners, active, start, len, periodIdx, flow, cumgross, stock };
}

export function assignPackedFlowRanks(packed: PackedRepoWindow): Uint32Array {
  const ranks = new Uint32Array(packed.flow.length);
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const rows: Array<{ cell: number; id: number; flow: number; cumgross: number }> = [];
    for (let repo = 0; repo < packed.ids.length; repo++) {
      const start = packed.start[repo]!;
      const end = start + packed.len[repo]!;
      const cell = findPackedCell(packed, start, end, periodIndex);
      if (cell < 0) continue;
      rows.push({
        cell,
        id: packed.ids[repo]!,
        flow: packed.flow[cell]!,
        cumgross: packed.cumgross[cell]!,
      });
    }
    rows.sort((a, b) => b.flow - a.flow || b.cumgross - a.cumgross || a.id - b.id);
    rows.forEach((row, index) => {
      ranks[row.cell] = index + 1;
    });
  }
  return ranks;
}

export function packedRepoRows(packed: PackedRepoWindow, repoIndex: number, flowRank?: Uint32Array): RepoRow[] {
  const start = packed.start[repoIndex]!;
  const end = start + packed.len[repoIndex]!;
  const rows: RepoRow[] = [];
  for (let cell = start; cell < end; cell++) {
    rows.push({
      period: packed.periods[packed.periodIdx[cell]!]!,
      flow: packed.flow[cell]!,
      cumgross: packed.cumgross[cell]!,
      stock_est: packed.stock[cell]!,
      flow_rank: flowRank?.[cell] ?? 0,
    });
  }
  return rows;
}

export function packedWindowMetaPath(runId: string, kind: PackedWindowKind): string {
  return `ops/workflows/${runId}/recompute/${kind}-win/meta.json`;
}

export function packedWindowBucketPath(runId: string, kind: PackedWindowKind, bucket: number): string {
  return `ops/workflows/${runId}/recompute/${kind}-win/${bucket}.json`;
}

export function packedBucketFile(packed: PackedRepoWindow, bucket: number, buckets: number): PackedWindowBucketFileV1 {
  const repos: PackedWindowBucketRepo[] = [];
  for (let repo = 0; repo < packed.ids.length; repo++) {
    const id = packed.ids[repo]!;
    if (id % buckets !== bucket) continue;
    const start = packed.start[repo]!;
    const end = start + packed.len[repo]!;
    const cells: Array<readonly [number, number, number, number]> = [];
    for (let cell = start; cell < end; cell++) {
      cells.push([packed.periodIdx[cell]!, packed.flow[cell]!, packed.cumgross[cell]!, packed.stock[cell]!]);
    }
    repos.push({
      id,
      owner: packed.owners[repo]!,
      active: packed.active[repo] === 1,
      cells,
    });
  }
  return { v: 1, repos };
}

/** Persist one already-bucketed packed window as flat arrays (week incremental pack). */
export function packedWindowAsFlatBucket(packed: PackedRepoWindow): PackedWindowBucketFileV2 {
  return {
    v: 2,
    ids: packed.ids,
    owners: packed.owners,
    active: Array.from(packed.active),
    start: Array.from(packed.start),
    len: Array.from(packed.len),
    periodIdx: Array.from(packed.periodIdx),
    flow: Array.from(packed.flow),
    cumgross: Array.from(packed.cumgross),
    stock: Array.from(packed.stock),
  };
}

export function packedMetaFile(
  kind: PackedWindowKind,
  seamPeriod: string,
  packed: { periods: string[] },
  buckets: number,
): PackedWindowMetaFile {
  return {
    v: 1,
    kind,
    seamPeriod,
    periods: packed.periods,
    buckets,
    complete: true,
  };
}

export function createPackedWindowAssembler(meta: PackedWindowMetaFile): {
  absorb(shard: PackedWindowBucketFile): void;
  finalize(): PackedRepoWindow;
} {
  const ids: number[] = [];
  const owners: string[] = [];
  const active: number[] = [];
  const starts: number[] = [];
  const lens: number[] = [];
  let cap = 1024;
  let n = 0;
  let periodIdx = new Uint16Array(cap);
  let flow = new Float64Array(cap);
  let cumgross = new Float64Array(cap);
  let stock = new Float64Array(cap);
  const grow = () => {
    cap *= 2;
    periodIdx = growCapacity(periodIdx, cap, (size) => new Uint16Array(size));
    flow = growCapacity(flow, cap, (size) => new Float64Array(size));
    cumgross = growCapacity(cumgross, cap, (size) => new Float64Array(size));
    stock = growCapacity(stock, cap, (size) => new Float64Array(size));
  };

  return {
    absorb(shard) {
      forEachPackedBucketRepo(shard, (repo) => {
        const start = n;
        for (const cell of repo.cells) {
          if (n >= cap) grow();
          periodIdx[n] = cell[0];
          flow[n] = cell[1];
          cumgross[n] = cell[2];
          stock[n] = cell[3];
          n += 1;
        }
        ids.push(repo.id);
        owners.push(repo.owner);
        active.push(repo.active ? 1 : 0);
        starts.push(start);
        lens.push(n - start);
      });
    },
    finalize() {
      return {
        ids,
        owners,
        active: Uint8Array.from(active),
        periods: meta.periods,
        start: Uint32Array.from(starts),
        len: Uint16Array.from(lens),
        periodIdx: periodIdx.slice(0, n),
        flow: flow.slice(0, n),
        cumgross: cumgross.slice(0, n),
        stock: stock.slice(0, n),
      };
    },
  };
}

export function assemblePackedWindow(meta: PackedWindowMetaFile, shards: PackedWindowBucketFile[]): PackedRepoWindow {
  const assembler = createPackedWindowAssembler(meta);
  for (const shard of shards) assembler.absorb(shard);
  return assembler.finalize();
}

export function coercePackedWindowMeta(json: unknown): PackedWindowMetaFile | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as {
    v?: unknown;
    kind?: unknown;
    seamPeriod?: unknown;
    periods?: unknown;
    buckets?: unknown;
    complete?: unknown;
  };
  if (rec.v !== 1 || (rec.kind !== "month" && rec.kind !== "week" && rec.kind !== "year")) return null;
  if (typeof rec.seamPeriod !== "string" || rec.complete !== true) return null;
  if (!Array.isArray(rec.periods) || typeof rec.buckets !== "number") return null;
  if (!rec.periods.every((period) => typeof period === "string")) return null;
  return {
    v: 1,
    kind: rec.kind,
    seamPeriod: rec.seamPeriod,
    periods: rec.periods,
    buckets: rec.buckets,
    complete: true,
  };
}

function coerceNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "number")) return null;
  return value;
}

export function coercePackedWindowBucket(json: unknown): PackedWindowBucketFile | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as {
    v?: unknown;
    repos?: unknown;
    ids?: unknown;
    owners?: unknown;
    active?: unknown;
    start?: unknown;
    len?: unknown;
    periodIdx?: unknown;
    flow?: unknown;
    cumgross?: unknown;
    stock?: unknown;
  };
  if (rec.v === 2) {
    const ids = coerceNumberArray(rec.ids);
    const start = coerceNumberArray(rec.start);
    const len = coerceNumberArray(rec.len);
    const periodIdx = coerceNumberArray(rec.periodIdx);
    const flow = coerceNumberArray(rec.flow);
    const cumgross = coerceNumberArray(rec.cumgross);
    const stock = coerceNumberArray(rec.stock);
    const active = coerceNumberArray(rec.active);
    if (!ids || !start || !len || !periodIdx || !flow || !cumgross || !stock || !active) return null;
    if (!Array.isArray(rec.owners) || !rec.owners.every((owner) => typeof owner === "string")) return null;
    if (ids.length !== rec.owners.length || ids.length !== active.length || ids.length !== start.length || ids.length !== len.length) {
      return null;
    }
    if (periodIdx.length !== flow.length || flow.length !== cumgross.length || cumgross.length !== stock.length) return null;
    return {
      v: 2,
      ids,
      owners: rec.owners,
      active,
      start,
      len,
      periodIdx,
      flow,
      cumgross,
      stock,
    };
  }
  if (rec.v !== 1 || !Array.isArray(rec.repos)) return null;
  const repos: PackedWindowBucketRepo[] = [];
  for (const row of rec.repos) {
    if (!row || typeof row !== "object") return null;
    const repo = row as { id?: unknown; owner?: unknown; active?: unknown; cells?: unknown };
    if (typeof repo.id !== "number" || typeof repo.owner !== "string" || typeof repo.active !== "boolean") return null;
    if (!Array.isArray(repo.cells)) return null;
    const cells: Array<readonly [number, number, number, number]> = [];
    for (const cell of repo.cells) {
      if (!Array.isArray(cell) || cell.length !== 4) return null;
      if (!cell.every((value) => typeof value === "number")) return null;
      cells.push([cell[0], cell[1], cell[2], cell[3]]);
    }
    repos.push({ id: repo.id, owner: repo.owner, active: repo.active, cells });
  }
  return { v: 1, repos };
}
