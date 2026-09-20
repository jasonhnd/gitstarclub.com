import { z } from "zod";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { CanonicalMeta, PendingPeriod, RepoMonthlyShard, RepoWeeklyShard, SiteDaily } from "@/lib/contracts";
import { REPO_BUCKETS, repoBucket } from "../buckets";
import { addDays, endOfMonth, monthsBetween, sundayOfWeekId, weekIdOf } from "./week-dates";
import { putOwnedView } from "@/lib/workflows/owned-write";
import type { FoldCursorAcc, FoldPhase, RefreshCursor } from "@/lib/workflows/runtime/types";

// Canonical fold. Folds CLOSED months (those with a frozen pending
// snapshot, after folded_through.month and before the current month) into canonical/v2:
// month flow → repo-monthly, daily totals → site-daily; advances meta.folded_through.month.
// THEN folds the CLOSED ISO weeks now fully inside frozen months into repo-weekly and advances
// meta.folded_through.week (see foldWeeks below). Folded periods are post-seam NET — the seam-aware
// recompute (windows.ts) adds them on top of the anchor without scaling them by d. Idempotent:
// upserts by period, only advances forward, so a workflow retry never double-counts. Runs after
// metadata, before recompute, so the recompute turns the folded weeks into top-100 week rankings.
// See VERCEL-DATA-OPERATIONS §7.2 for the period closeout handoff.
//
// CF Workers (128 MiB): one invocation must not keep every pending + 32 monthly + 32 weekly
// shards in the isolate. The CF/HTTP graph calls runFoldStep (4-bucket windows, sequential
// pending absorb, compact week plan). foldCanonical still loops those windows in-process.

export const FOLD_BUCKETS_PER_JOB = 4;

const FoldWeekPlanView = z
  .object({
    foldedThroughMonth: z.string(),
    fromWeekExclusive: z.string(),
    weeks: z.array(
      z.object({
        week: z.string(),
        repos: z.array(z.tuple([z.number().int(), z.number().int()])),
      }),
    ),
  })
  .strict();

export type FoldWeekPlan = z.infer<typeof FoldWeekPlanView>;

export type FoldStepFields = {
  folded: string[];
  foldedWeeks: string[];
  nextFoldPhase?: FoldPhase;
  nextFoldMonth?: string;
  nextFoldOffset?: number;
  nextFoldSeq?: number;
  foldAcc?: FoldCursorAcc;
};

export type FoldIo = {
  readMeta(): Promise<CanonicalMeta>;
  readPending(month: string): Promise<PendingPeriod | null>;
  readMonthlyShard(bucket: number): Promise<RepoMonthlyShard>;
  readWeeklyShard(bucket: number): Promise<RepoWeeklyShard>;
  readSiteDaily(year: string): Promise<SiteDaily | null>;
  writeMonthlyShard(bucket: number, shard: RepoMonthlyShard): Promise<void>;
  writeWeeklyShard(bucket: number, shard: RepoWeeklyShard): Promise<void>;
  writeSiteDaily(year: string, site: SiteDaily): Promise<void>;
  writeMeta(meta: CanonicalMeta): Promise<void>;
  readWeekPlan(): Promise<FoldWeekPlan | null>;
  writeWeekPlan(plan: FoldWeekPlan): Promise<void>;
};

export type FoldStepOptions = {
  io?: FoldIo;
  now?: Date;
  buckets?: number;
};

export function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo >= 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

/** UTC 'YYYY-MM' of `now`. Local so the closed-month gate follows the injected clock,
 *  not `@/lib/periods` — `mock.module` of that specifier leaks across `bun test lib/`
 *  (uiux-seo / watermark) and would skip a still-closed month. */
export function utcMonthPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function foldedCanonicalMeta(
  meta: CanonicalMeta,
  foldedThroughMonth: string,
  foldedThroughWeek: string,
  generatedAt: string,
): CanonicalMeta {
  return CanonicalMeta.parse({
    seam_date: meta.seam_date,
    schema_ver: meta.schema_ver,
    folded_through: { month: foldedThroughMonth, week: foldedThroughWeek },
    generated_at: generatedAt,
  });
}

export function hasNextFoldWindow(result: { [key: string]: unknown }): boolean {
  return result.nextFoldPhase === "month" || result.nextFoldPhase === "week" || typeof result.nextFoldOffset === "number";
}

export function foldStepCheckpointName(cursor: RefreshCursor): string {
  const phase = cursor.foldPhase === "week" ? "week" : "month";
  return `fold-${phase}-${cursor.foldSeq ?? 0}`;
}

export function foldBucketWindow(offset: number, buckets = REPO_BUCKETS): number[] {
  const count = Math.min(FOLD_BUCKETS_PER_JOB, buckets - offset);
  if (count <= 0) {
    throw new Error(`fold bucket offset ${offset} is outside ${buckets} buckets`);
  }
  return Array.from({ length: count }, (_, index) => offset + index);
}

/** In-process / Vercel path: drain every CF fold window in this process. */
export async function foldCanonical(
  runId: string,
  fencingToken: number,
  opts: FoldStepOptions = {},
): Promise<{ folded: string[]; foldedWeeks: string[] }> {
  let cursor: RefreshCursor = {};
  for (;;) {
    const step = await runFoldStep(runId, fencingToken, cursor, opts);
    if (!hasNextFoldWindow(step)) return { folded: step.folded, foldedWeeks: step.foldedWeeks };
    cursor = {
      foldPhase: step.nextFoldPhase,
      foldMonth: step.nextFoldMonth,
      foldOffset: step.nextFoldOffset,
      foldSeq: step.nextFoldSeq,
      foldAcc: step.foldAcc,
    };
  }
}

export async function runFoldStep(
  runId: string,
  fencingToken: number,
  cursor: RefreshCursor = {},
  opts: FoldStepOptions = {},
): Promise<FoldStepFields> {
  const bucketsTotal = opts.buckets ?? REPO_BUCKETS;
  const io = opts.io ?? createDefaultFoldIo(runId, fencingToken);
  const meta = await io.readMeta();
  const acc = copyFoldAcc(cursor.foldAcc ?? emptyFoldAcc(meta));
  const seq = cursor.foldSeq ?? 0;
  const currentMonth = utcMonthPeriod(opts.now ?? new Date());
  const phase: FoldPhase = cursor.foldPhase === "week" ? "week" : "month";

  if (phase === "month") {
    const month = cursor.foldMonth ?? nextMonth(acc.foldedThroughMonth);
    if (month >= currentMonth) {
      return runWeekPhase(io, meta, acc, seq, 0, bucketsTotal);
    }
    const pending = await io.readPending(month);
    if (!pending) {
      return runWeekPhase(io, meta, acc, seq, 0, bucketsTotal);
    }
    if (pending.period !== month) {
      throw new Error(`canonical/v2/pending/${month}.json: period ${pending.period} does not match ${month}`);
    }
    const offset = cursor.foldOffset ?? 0;
    const window = foldBucketWindow(offset, bucketsTotal);
    await writeMonthlyBucketWindow(month, pending, window, io);
    const nextOffset = offset + window.length;
    if (nextOffset < bucketsTotal) {
      return continueFold(acc, seq, { phase: "month", month, offset: nextOffset });
    }
    await writeSiteDailyForPending(pending, io);
    acc.foldedThroughMonth = month;
    acc.folded.push(month);
    const following = nextMonth(month);
    if (following < currentMonth) {
      return continueFold(acc, seq, { phase: "month", month: following, offset: 0 });
    }
    return continueFold(acc, seq, { phase: "week", offset: 0 });
  }

  return runWeekPhase(io, meta, acc, seq, cursor.foldOffset ?? 0, bucketsTotal);
}

function createDefaultFoldIo(runId: string, fencingToken: number): FoldIo {
  const owner = { runId, fencingToken };
  const bust = runId;
  return {
    readMeta: () => readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust }),
    readPending: (month) => readAuthoritativeView(`canonical/v2/pending/${month}.json`, PendingPeriod, { bust }),
    readMonthlyShard: (bucket) =>
      readRequiredView(`canonical/v2/repo-monthly/${bucket}.json`, RepoMonthlyShard, { bust }),
    readWeeklyShard: (bucket) =>
      readRequiredView(`canonical/v2/repo-weekly/${bucket}.json`, RepoWeeklyShard, { bust }),
    readSiteDaily: (year) => readAuthoritativeView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust }),
    writeMonthlyShard: (bucket, shard) => putOwnedView(owner, `canonical/v2/repo-monthly/${bucket}.json`, shard),
    writeWeeklyShard: (bucket, shard) => putOwnedView(owner, `canonical/v2/repo-weekly/${bucket}.json`, shard),
    writeSiteDaily: (year, site) => putOwnedView(owner, `canonical/v2/site-daily/${year}.json`, site),
    writeMeta: (next) => putOwnedView(owner, "canonical/v2/meta.json", next),
    readWeekPlan: () => readAuthoritativeView(`ops/workflows/${runId}/fold-week-plan.json`, FoldWeekPlanView, { bust }),
    writeWeekPlan: (plan) => putOwnedView(owner, `ops/workflows/${runId}/fold-week-plan.json`, plan),
  };
}

function emptyFoldAcc(meta: CanonicalMeta): FoldCursorAcc {
  return {
    folded: [],
    foldedWeeks: [],
    foldedThroughMonth: meta.folded_through.month,
    foldedThroughWeek: meta.folded_through.week,
  };
}

function copyFoldAcc(acc: FoldCursorAcc): FoldCursorAcc {
  return {
    folded: [...acc.folded],
    foldedWeeks: [...acc.foldedWeeks],
    foldedThroughMonth: acc.foldedThroughMonth,
    foldedThroughWeek: acc.foldedThroughWeek,
  };
}

function continueFold(
  acc: FoldCursorAcc,
  seq: number,
  next: { phase: FoldPhase; month?: string; offset: number },
): FoldStepFields {
  return {
    folded: acc.folded,
    foldedWeeks: acc.foldedWeeks,
    nextFoldPhase: next.phase,
    nextFoldMonth: next.month,
    nextFoldOffset: next.offset,
    nextFoldSeq: seq + 1,
    foldAcc: acc,
  };
}

function finishFold(acc: FoldCursorAcc): FoldStepFields {
  return { folded: acc.folded, foldedWeeks: acc.foldedWeeks };
}

async function runWeekPhase(
  io: FoldIo,
  meta: CanonicalMeta,
  acc: FoldCursorAcc,
  seq: number,
  offset: number,
  bucketsTotal: number,
): Promise<FoldStepFields> {
  let plan = offset === 0 ? null : await io.readWeekPlan();
  if (offset === 0) {
    const firstMonday = addDays(sundayOfWeekId(acc.foldedThroughWeek), 1);
    const lastFoldableDay = endOfMonth(acc.foldedThroughMonth);
    if (firstMonday > lastFoldableDay) {
      await commitMetaIfNeeded(io, meta, acc);
      return finishFold(acc);
    }
    const months = monthsBetween(firstMonday, lastFoldableDay);
    const byDate = new Map<string, Map<number, number>>();
    const fromWeekExclusive = acc.foldedThroughWeek;
    for (const month of months) {
      const pending = await io.readPending(month);
      if (!pending) {
        throw new Error(`canonical/v2/pending: missing required frozen period(s) ${month}`);
      }
      if (pending.period !== month) {
        throw new Error(`canonical/v2/pending/${month}.json: period ${pending.period} does not match ${month}`);
      }
      absorbPendingIntoByDate(byDate, pending);
    }
    const rows = weekRowsFromByDate(byDate, fromWeekExclusive, acc.foldedThroughMonth);
    acc.foldedWeeks = rows.map((row) => row.week);
    if (rows.length > 0) acc.foldedThroughWeek = rows[rows.length - 1]!.week;
    if (rows.length === 0) {
      await commitMetaIfNeeded(io, meta, acc);
      return finishFold(acc);
    }
    plan = {
      foldedThroughMonth: acc.foldedThroughMonth,
      fromWeekExclusive,
      weeks: weekPlanFromRows(rows),
    };
    await io.writeWeekPlan(plan);
  }
  if (!plan) {
    throw new Error("canonical/v2 pending week fold: missing compact week plan");
  }
  const window = foldBucketWindow(offset, bucketsTotal);
  await writeWeeklyBucketWindow(plan, window, io);
  const nextOffset = offset + window.length;
  if (nextOffset < bucketsTotal) {
    return continueFold(acc, seq, { phase: "week", offset: nextOffset });
  }
  await commitMetaIfNeeded(io, meta, acc);
  return finishFold(acc);
}

async function commitMetaIfNeeded(io: FoldIo, meta: CanonicalMeta, acc: FoldCursorAcc): Promise<void> {
  if (!acc.folded.length && !acc.foldedWeeks.length) return;
  await io.writeMeta(foldedCanonicalMeta(meta, acc.foldedThroughMonth, acc.foldedThroughWeek, new Date().toISOString()));
}

function sortPeriodSeries(series: Array<[string, number]>): Array<[string, number]> {
  series.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  return series;
}

export function pendingFlowsForBuckets(
  pending: PendingPeriod,
  buckets: readonly number[],
): Map<number, Array<[number, number]>> {
  const wanted = new Set(buckets);
  const byBucket = new Map<number, Array<[number, number]>>();
  for (const [idStr, series] of Object.entries(pending.per_repo)) {
    const id = Number(idStr);
    const bucket = repoBucket(id);
    if (!wanted.has(bucket)) continue;
    let flow = 0;
    for (const [, delta] of series) flow += delta;
    if (flow === 0) continue;
    let arr = byBucket.get(bucket);
    if (!arr) byBucket.set(bucket, (arr = []));
    arr.push([id, flow]);
  }
  return byBucket;
}

export function dropPendingReposOutsideBuckets(pending: PendingPeriod, buckets: readonly number[]): void {
  const wanted = new Set(buckets);
  for (const idStr of Object.keys(pending.per_repo)) {
    if (!wanted.has(repoBucket(Number(idStr)))) delete pending.per_repo[idStr];
  }
}

async function writeMonthlyBucketWindow(
  month: string,
  pending: PendingPeriod,
  buckets: readonly number[],
  io: FoldIo,
): Promise<void> {
  dropPendingReposOutsideBuckets(pending, buckets);
  const byBucket = pendingFlowsForBuckets(pending, buckets);
  for (const bucket of buckets) {
    const shard = await io.readMonthlyShard(bucket);
    for (const [id, flow] of byBucket.get(bucket) ?? []) {
      const series = (shard[String(id)] ?? []).filter(([period]) => period !== month);
      series.push([month, flow]);
      shard[String(id)] = sortPeriodSeries(series);
    }
    await io.writeMonthlyShard(bucket, shard);
  }
}

async function writeSiteDailyForPending(pending: PendingPeriod, io: FoldIo): Promise<void> {
  const year = pending.period.slice(0, 4);
  const site = (await io.readSiteDaily(year)) ?? { year, cells: [] };
  const cells = new Map<string, number>(site.cells.map(([date, total]) => [date, total]));
  for (const [date, total] of pending.daily_totals) cells.set(date, total);
  await io.writeSiteDaily(year, {
    year,
    cells: [...cells.entries()].sort((left, right) => (left[0] < right[0] ? -1 : 1)),
  });
}

export function weekPlanFromRows(rows: WeekRow[]): FoldWeekPlan["weeks"] {
  return rows.map((row) => ({
    week: row.week,
    repos: [...row.perRepo.entries()].filter(([, flow]) => flow !== 0),
  }));
}

async function writeWeeklyBucketWindow(plan: FoldWeekPlan, buckets: readonly number[], io: FoldIo): Promise<void> {
  const wanted = new Set(buckets);
  for (const bucket of buckets) {
    const shard = await io.readWeeklyShard(bucket);
    for (const row of plan.weeks) {
      for (const [id, flow] of row.repos) {
        if (!wanted.has(repoBucket(id))) continue;
        const series = (shard[String(id)] ?? []).filter(([period]) => period !== row.week);
        series.push([row.week, flow]);
        shard[String(id)] = sortPeriodSeries(series);
      }
    }
    await io.writeWeeklyShard(bucket, shard);
  }
}

/** One folded week: id + per-repo flow (Σ daily deltas of that repo whose date lands in the week). */
export interface WeekRow {
  week: string;
  perRepo: Map<number, number>;
}

/** A weekly fold may span several already-frozen months. Missing any one of
 * those immutable handoff artifacts would turn real deltas into zero rows, so
 * validate the complete period set before computing or writing weekly data. */
export function requireCompletePendingPeriods(
  periods: string[],
  values: Array<PendingPeriod | null>,
): PendingPeriod[] {
  if (periods.length !== values.length) {
    throw new Error("canonical/v2/pending: period/read count mismatch");
  }
  const missing = periods.filter((_, index) => values[index] === null);
  if (missing.length > 0) {
    throw new Error(`canonical/v2/pending: missing required frozen period(s) ${missing.join(",")}`);
  }
  return values.map((pending, index) => {
    if (pending!.period !== periods[index]) {
      throw new Error(
        `canonical/v2/pending/${periods[index]}.json: period ${pending!.period} does not match ${periods[index]}`,
      );
    }
    return pending!;
  });
}

export function absorbPendingIntoByDate(
  byDate: Map<string, Map<number, number>>,
  pending: PendingPeriod,
): void {
  for (const [idStr, series] of Object.entries(pending.per_repo)) {
    const id = Number(idStr);
    for (const [date, delta] of series) {
      if (delta === 0) continue;
      let day = byDate.get(date);
      if (!day) byDate.set(date, (day = new Map()));
      day.set(id, (day.get(id) ?? 0) + delta);
    }
  }
}

export function weekRowsFromByDate(
  byDate: Map<string, Map<number, number>>,
  fromWeekExclusive: string,
  foldedMonth: string,
): WeekRow[] {
  const lastFoldableDay = endOfMonth(foldedMonth); // a week folds only if its Sunday ≤ this
  const firstMonday = addDays(sundayOfWeekId(fromWeekExclusive), 1); // day after the from-week's Sunday
  const rows: WeekRow[] = [];

  // enumerate weeks contiguously by Monday (+7d) while the week's Sunday is fully inside frozen months.
  for (let monday = firstMonday; addDays(monday, 6) <= lastFoldableDay; monday = addDays(monday, 7)) {
    const week = weekIdOf(monday);
    const perRepo = new Map<number, number>();
    for (let i = 0; i < 7; i++) {
      const day = byDate.get(addDays(monday, i));
      if (!day) continue;
      for (const [id, delta] of day) perRepo.set(id, (perRepo.get(id) ?? 0) + delta);
    }
    for (const [id, flow] of [...perRepo]) if (flow === 0) perRepo.delete(id); // drop net-zero repos
    rows.push({ week, perRepo });
  }
  return rows;
}

/** PURE core (no I/O) of the week fold — the testable seam. Given the FROZEN month pendings that
 *  cover the candidate weeks plus the (exclusive) from-week and the last frozen month, return one
 *  WeekRow per ISO week W with W > fromWeekExclusive whose LAST day (Sunday) ≤ end-of-foldedMonth,
 *  CONTIGUOUSLY ascending (enumerated by stepping +7 days, so even an all-zero week is emitted to
 *  keep the watermark gap-free). Cross-month weeks naturally sum days from BOTH months' pendings
 *  because all days are collapsed into one date→delta map first. Repos with 0 week flow are dropped
 *  from perRepo (but the WeekRow itself stays so the watermark still advances past it). */
export function computeWeekRows(pendings: PendingPeriod[], fromWeekExclusive: string, foldedMonth: string): WeekRow[] {
  const byDate = new Map<string, Map<number, number>>();
  for (const pending of pendings) absorbPendingIntoByDate(byDate, pending);
  return weekRowsFromByDate(byDate, fromWeekExclusive, foldedMonth);
}
