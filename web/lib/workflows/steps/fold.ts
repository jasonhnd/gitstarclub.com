import { z } from "zod";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { CanonicalMeta, PendingPeriod, RepoMonthlyShard, RepoWeeklyShard, SiteDaily } from "@/lib/contracts";
import { isCloudflareWorkersHost } from "@/lib/runtime-config";
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
// CF Workers (128 MiB): one invocation must not keep a frozen pending + several
// monthly/weekly shards. #479's 4-bucket window still OOM'd after fold-month-0
// (preview run refresh-2026-09-20T14-03-08-908Z): each later window reloaded the
// full pending, and isolate reuse / response serialization sat on top of 4 shards.
// CF/HTTP now: 1-bucket windows; compact month + week plans so shard jobs do not
// reload pending; plan-build is its own hop (retry after the plan exists is cheap).
// The first hop always writes fold-decision.json so a no-op (already folded
// through the last closed month) is visible and is not mistaken for a missing
// plan. foldCanonical still drains those windows in-process.

export const FOLD_BUCKETS_PER_JOB = 1;

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

const FoldMonthPlanView = z
  .object({
    month: z.string(),
    daily_totals: z.array(z.tuple([z.string(), z.number().int()])),
    buckets: z.array(z.array(z.tuple([z.number().int(), z.number().int()]))),
  })
  .strict();

export type FoldMonthPlan = z.infer<typeof FoldMonthPlanView>;

const FoldDecisionView = z
  .object({
    currentMonth: z.string(),
    foldedThroughMonth: z.string(),
    foldedThroughWeek: z.string(),
    nextFoldMonth: z.string().nullable(),
    monthPlan: z.boolean(),
    weekPlan: z.boolean(),
    reason: z.enum(["month_plan", "no_closed_month", "pending_missing", "week_only", "nothing_to_fold"]),
  })
  .strict();

export type FoldDecision = z.infer<typeof FoldDecisionView>;

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
  readMonthPlan(): Promise<FoldMonthPlan | null>;
  writeMonthPlan(plan: FoldMonthPlan): Promise<void>;
  readWeekPlan(): Promise<FoldWeekPlan | null>;
  writeWeekPlan(plan: FoldWeekPlan): Promise<void>;
  writeDecision(decision: FoldDecision): Promise<void>;
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
  clearViewParseMemo();
  const meta = await io.readMeta();
  const acc = copyFoldAcc(cursor.foldAcc ?? emptyFoldAcc(meta));
  const seq = cursor.foldSeq ?? 0;
  const currentMonth = utcMonthPeriod(opts.now ?? new Date());
  const phase: FoldPhase = cursor.foldPhase === "week" ? "week" : "month";

  if (phase === "month") {
    const month = cursor.foldMonth ?? nextMonth(acc.foldedThroughMonth);
    if (month >= currentMonth) {
      return runWeekPhase(io, meta, acc, seq, 0, bucketsTotal, currentMonth, false, "no_closed_month");
    }
    const offset = cursor.foldOffset ?? 0;
    let plan = await loadMonthPlan(io, month, bucketsTotal);
    if (!plan) {
      const pending = await io.readPending(month);
      if (!pending) {
        if (seq === 0) {
          await io.writeDecision(
            foldDecision({
              currentMonth,
              acc,
              nextFoldMonth: month,
              monthPlan: false,
              weekPlan: false,
              reason: "pending_missing",
            }),
          );
        }
        return runWeekPhase(io, meta, acc, seq, 0, bucketsTotal, currentMonth, true);
      }
      if (pending.period !== month) {
        throw new Error(`canonical/v2/pending/${month}.json: period ${pending.period} does not match ${month}`);
      }
      plan = monthPlanFromPending(pending, bucketsTotal);
      await io.writeMonthPlan(plan);
      clearViewParseMemo();
      if (seq === 0) {
        await io.writeDecision(
          foldDecision({
            currentMonth,
            acc,
            nextFoldMonth: month,
            monthPlan: true,
            weekPlan: false,
            reason: "month_plan",
          }),
        );
      }
      // Plan hop only: do not also hold monthly shards in this isolate.
      // A Queue retry after the plan exists skips pending and writes one shard.
      if (offset === 0) {
        return continueFold(acc, seq, { phase: "month", month, offset: 0 });
      }
    }
    const window = foldBucketWindow(offset, bucketsTotal);
    const dailyTotals = plan.daily_totals;
    await writeMonthlyBucketWindow(month, monthPlanFlowsForBuckets(plan, window), window, io);
    const nextOffset = offset + window.length;
    if (nextOffset < bucketsTotal) {
      return continueFold(acc, seq, { phase: "month", month, offset: nextOffset });
    }
    await writeSiteDailyFromTotals(month, dailyTotals, io);
    acc.foldedThroughMonth = month;
    acc.folded.push(month);
    const following = nextMonth(month);
    if (following < currentMonth) {
      return continueFold(acc, seq, { phase: "month", month: following, offset: 0 });
    }
    return continueFold(acc, seq, { phase: "week", offset: 0 });
  }

  return runWeekPhase(io, meta, acc, seq, cursor.foldOffset ?? 0, bucketsTotal, currentMonth, false);
}

function createDefaultFoldIo(runId: string, fencingToken: number): FoldIo {
  const owner = { runId, fencingToken };
  const bust = runId;
  return {
    readMeta: () => readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust }),
    readMonthlyShard: (bucket) =>
      readRequiredView(`canonical/v2/repo-monthly/${bucket}.json`, RepoMonthlyShard, { bust }),
    readWeeklyShard: (bucket) =>
      readRequiredView(`canonical/v2/repo-weekly/${bucket}.json`, RepoWeeklyShard, { bust }),
    readSiteDaily: (year) => readAuthoritativeView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust }),
    writeMonthlyShard: (bucket, shard) => putOwnedView(owner, `canonical/v2/repo-monthly/${bucket}.json`, shard),
    writeWeeklyShard: (bucket, shard) => putOwnedView(owner, `canonical/v2/repo-weekly/${bucket}.json`, shard),
    writeSiteDaily: (year, site) => putOwnedView(owner, `canonical/v2/site-daily/${year}.json`, site),
    writeMeta: (next) => putOwnedView(owner, "canonical/v2/meta.json", next),
    readMonthPlan: () => readAuthoritativeView(`ops/workflows/${runId}/fold-month-plan.json`, FoldMonthPlanView, { bust }),
    writeMonthPlan: (plan) => putOwnedView(owner, `ops/workflows/${runId}/fold-month-plan.json`, plan),
    readWeekPlan: () => readAuthoritativeView(`ops/workflows/${runId}/fold-week-plan.json`, FoldWeekPlanView, { bust }),
    writeWeekPlan: (plan) => putOwnedView(owner, `ops/workflows/${runId}/fold-week-plan.json`, plan),
    writeDecision: (decision) => putOwnedView(owner, `ops/workflows/${runId}/fold-decision.json`, decision),
    readPending: (month) => readPendingForFold(month, bust),
  };
}

async function readPendingForFold(month: string, bust: string): Promise<PendingPeriod | null> {
  const skipSchemaParse = isCloudflareWorkersHost();
  const json = await readAuthoritativeView(`canonical/v2/pending/${month}.json`, PendingPeriod, {
    bust,
    skipSchemaParse,
  });
  if (json === null) return null;
  return skipSchemaParse ? coercePendingPeriod(json, month) : json;
}

function foldDecision(input: {
  currentMonth: string;
  acc: FoldCursorAcc;
  nextFoldMonth: string | null;
  monthPlan: boolean;
  weekPlan: boolean;
  reason: FoldDecision["reason"];
}): FoldDecision {
  return FoldDecisionView.parse({
    currentMonth: input.currentMonth,
    foldedThroughMonth: input.acc.foldedThroughMonth,
    foldedThroughWeek: input.acc.foldedThroughWeek,
    nextFoldMonth: input.nextFoldMonth,
    monthPlan: input.monthPlan,
    weekPlan: input.weekPlan,
    reason: input.reason,
  });
}

/** Light pending gate for CF: avoid a second Zod walk of every daily series. */
export function coercePendingPeriod(json: unknown, month: string): PendingPeriod {
  if (!json || typeof json !== "object") {
    throw new Error(`canonical/v2/pending/${month}.json: not an object`);
  }
  const rec = json as {
    period?: unknown;
    frozen_at?: unknown;
    daily_totals?: unknown;
    per_repo?: unknown;
  };
  if (rec.period !== month) {
    throw new Error(`canonical/v2/pending/${month}.json: period ${String(rec.period)} does not match ${month}`);
  }
  if (typeof rec.frozen_at !== "string") {
    throw new Error(`canonical/v2/pending/${month}.json: missing frozen_at`);
  }
  if (!Array.isArray(rec.daily_totals) || !rec.per_repo || typeof rec.per_repo !== "object") {
    throw new Error(`canonical/v2/pending/${month}.json: missing daily_totals/per_repo`);
  }
  return rec as PendingPeriod;
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
  currentMonth: string,
  wroteMonthDecision: boolean,
  emptyReason: FoldDecision["reason"] = "nothing_to_fold",
): Promise<FoldStepFields> {
  let plan = await loadWeekPlan(io, acc.foldedThroughMonth);
  if (!plan) {
    const firstMonday = addDays(sundayOfWeekId(acc.foldedThroughWeek), 1);
    const lastFoldableDay = endOfMonth(acc.foldedThroughMonth);
    if (firstMonday > lastFoldableDay) {
      if (seq === 0 && !wroteMonthDecision) {
        await io.writeDecision(
          foldDecision({
            currentMonth,
            acc,
            nextFoldMonth: null,
            monthPlan: false,
            weekPlan: false,
            reason: emptyReason,
          }),
        );
      }
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
      pending.per_repo = {};
      clearViewParseMemo();
    }
    const rows = weekRowsFromByDate(byDate, fromWeekExclusive, acc.foldedThroughMonth);
    byDate.clear();
    if (rows.length === 0) {
      if (seq === 0 && !wroteMonthDecision) {
        await io.writeDecision(
          foldDecision({
            currentMonth,
            acc,
            nextFoldMonth: null,
            monthPlan: false,
            weekPlan: false,
            reason: emptyReason,
          }),
        );
      }
      await commitMetaIfNeeded(io, meta, acc);
      return finishFold(acc);
    }
    if (seq === 0 && !wroteMonthDecision) {
      await io.writeDecision(
        foldDecision({
          currentMonth,
          acc,
          nextFoldMonth: null,
          monthPlan: false,
          weekPlan: true,
          reason: "week_only",
        }),
      );
    }
    acc.foldedWeeks = rows.map((row) => row.week);
    acc.foldedThroughWeek = rows[rows.length - 1]!.week;
    plan = {
      foldedThroughMonth: acc.foldedThroughMonth,
      fromWeekExclusive,
      weeks: weekPlanFromRows(rows),
    };
    await io.writeWeekPlan(plan);
    clearViewParseMemo();
    if (offset === 0) {
      return continueFold(acc, seq, { phase: "week", offset: 0 });
    }
  }
  applyWeekPlanToAcc(acc, plan);
  const window = foldBucketWindow(offset, bucketsTotal);
  await writeWeeklyBucketWindow(weekPlanForBuckets(plan, window), window, io);
  const nextOffset = offset + window.length;
  if (nextOffset < bucketsTotal) {
    return continueFold(acc, seq, { phase: "week", offset: nextOffset });
  }
  await commitMetaIfNeeded(io, meta, acc);
  return finishFold(acc);
}

async function loadMonthPlan(io: FoldIo, month: string, bucketsTotal: number): Promise<FoldMonthPlan | null> {
  const plan = await io.readMonthPlan();
  if (!plan || plan.month !== month || plan.buckets.length !== bucketsTotal) return null;
  return plan;
}

async function loadWeekPlan(io: FoldIo, foldedThroughMonth: string): Promise<FoldWeekPlan | null> {
  const plan = await io.readWeekPlan();
  if (!plan || plan.foldedThroughMonth !== foldedThroughMonth) return null;
  return plan;
}

function applyWeekPlanToAcc(acc: FoldCursorAcc, plan: FoldWeekPlan): void {
  if (acc.foldedWeeks.length > 0) return;
  acc.foldedWeeks = plan.weeks.map((row) => row.week);
  if (plan.weeks.length > 0) acc.foldedThroughWeek = plan.weeks[plan.weeks.length - 1]!.week;
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

/** Compact month plan: [repo_id, month flow] per bucket. Deletes pending.per_repo as it walks. */
export function monthPlanFromPending(pending: PendingPeriod, bucketsTotal: number): FoldMonthPlan {
  const buckets: Array<Array<[number, number]>> = Array.from({ length: bucketsTotal }, () => []);
  for (const idStr of Object.keys(pending.per_repo)) {
    const series = pending.per_repo[idStr]!;
    const id = Number(idStr);
    let flow = 0;
    for (const [, delta] of series) flow += delta;
    delete pending.per_repo[idStr];
    if (flow === 0) continue;
    const bucket = repoBucket(id);
    if (bucket >= 0 && bucket < bucketsTotal) buckets[bucket]!.push([id, flow]);
  }
  return { month: pending.period, daily_totals: pending.daily_totals, buckets };
}

export function monthPlanFlowsForBuckets(
  plan: FoldMonthPlan,
  buckets: readonly number[],
): Map<number, Array<[number, number]>> {
  const byBucket = new Map<number, Array<[number, number]>>();
  for (const bucket of buckets) {
    const rows = plan.buckets[bucket];
    if (rows?.length) byBucket.set(bucket, rows);
  }
  return byBucket;
}

async function writeMonthlyBucketWindow(
  month: string,
  byBucket: Map<number, Array<[number, number]>>,
  buckets: readonly number[],
  io: FoldIo,
): Promise<void> {
  for (const bucket of buckets) {
    const shard = await io.readMonthlyShard(bucket);
    for (const [id, flow] of byBucket.get(bucket) ?? []) {
      const series = (shard[String(id)] ?? []).filter(([period]) => period !== month);
      series.push([month, flow]);
      shard[String(id)] = sortPeriodSeries(series);
    }
    await io.writeMonthlyShard(bucket, shard);
    clearViewParseMemo();
  }
}

async function writeSiteDailyFromTotals(
  month: string,
  dailyTotals: ReadonlyArray<[string, number]>,
  io: FoldIo,
): Promise<void> {
  const year = month.slice(0, 4);
  const site = (await io.readSiteDaily(year)) ?? { year, cells: [] };
  const cells = new Map<string, number>(site.cells.map(([date, total]) => [date, total]));
  for (const [date, total] of dailyTotals) cells.set(date, total);
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

export function weekPlanForBuckets(plan: FoldWeekPlan, buckets: readonly number[]): FoldWeekPlan {
  const wanted = new Set(buckets);
  return {
    foldedThroughMonth: plan.foldedThroughMonth,
    fromWeekExclusive: plan.fromWeekExclusive,
    weeks: plan.weeks.map((row) => ({
      week: row.week,
      repos: row.repos.filter(([id]) => wanted.has(repoBucket(id))),
    })),
  };
}

async function writeWeeklyBucketWindow(plan: FoldWeekPlan, buckets: readonly number[], io: FoldIo): Promise<void> {
  for (const bucket of buckets) {
    const shard = await io.readWeeklyShard(bucket);
    for (const row of plan.weeks) {
      for (const [id, flow] of row.repos) {
        if (repoBucket(id) !== bucket) continue;
        const series = (shard[String(id)] ?? []).filter(([period]) => period !== row.week);
        series.push([row.week, flow]);
        shard[String(id)] = sortPeriodSeries(series);
      }
    }
    await io.writeWeeklyShard(bucket, shard);
    clearViewParseMemo();
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
