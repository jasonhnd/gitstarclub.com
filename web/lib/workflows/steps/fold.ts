import { readView } from "@/lib/data/source";
import { CanonicalMeta, PendingPeriod, RepoMonthlyShard, RepoWeeklyShard, SiteDaily } from "@/lib/contracts";
import { repoBucket } from "../buckets";
import { currentUtcPeriods } from "@/lib/periods";
import { addDays, endOfMonth, monthsBetween, sundayOfWeekId, weekIdOf } from "./week-dates";
import { putOwnedView } from "@/lib/workflows/owned-write";

// Canonical fold. Folds CLOSED months (those with a frozen pending
// snapshot, after folded_through.month and before the current month) into canonical/v2:
// month flow → repo-monthly, daily totals → site-daily; advances meta.folded_through.month.
// THEN folds the CLOSED ISO weeks now fully inside frozen months into repo-weekly and advances
// meta.folded_through.week (see foldWeeks below). Folded periods are post-seam NET — the seam-aware
// recompute (windows.ts) adds them on top of the anchor without scaling them by d. Idempotent:
// upserts by period, only advances forward, so a workflow retry never double-counts. Runs after
// metadata, before recompute, so the recompute turns the folded weeks into top-100 week rankings.
// See VERCEL-DATA-OPERATIONS §7.2 for the period closeout handoff.

export function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo >= 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
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

export async function foldCanonical(runId: string, fencingToken: number): Promise<{ folded: string[]; foldedWeeks: string[] }> {
  "use step";
  const meta = await readView("canonical/v2/meta.json", CanonicalMeta, { bust: runId });
  if (!meta) throw new Error("canonical/v2/meta.json missing");

  const currentMonth = currentUtcPeriods().monthPeriod;
  const folded: string[] = [];
  let foldedThroughMonth = meta.folded_through.month;

  for (let m = nextMonth(foldedThroughMonth); m < currentMonth; m = nextMonth(m)) {
    const pending = await readView(`canonical/v2/pending/${m}.json`, PendingPeriod, { bust: runId });
    if (!pending) break; // keep the watermark contiguous — stop at the first un-frozen month
    await foldMonth(m, pending, runId, fencingToken);
    foldedThroughMonth = m;
    folded.push(m);
  }

  // Weeks fold AFTER months: a closed ISO week is foldable only once ALL its days live in frozen
  // months (its Sunday's month ≤ foldedThroughMonth). Cross-month weeks pull days from two pendings.
  const foldedWeeks = await foldWeeks(foldedThroughMonth, meta.folded_through.week, runId, fencingToken);
  const foldedThroughWeek = foldedWeeks.length ? foldedWeeks[foldedWeeks.length - 1] : meta.folded_through.week;

  // Write meta ONCE with both advances (month from the loop, week from foldWeeks).
  if (folded.length || foldedWeeks.length) {
    await putOwnedView(
      { runId, fencingToken },
      "canonical/v2/meta.json",
      foldedCanonicalMeta(meta, foldedThroughMonth, foldedThroughWeek, new Date().toISOString()),
    );
  }
  return { folded, foldedWeeks };
}

async function foldMonth(month: string, pending: PendingPeriod, runId: string, fencingToken: number): Promise<void> {
  // month flow per repo = Σ daily deltas in the frozen pending snapshot, grouped by bucket.
  const byBucket = new Map<number, Array<[number, number]>>();
  for (const [idStr, series] of Object.entries(pending.per_repo)) {
    let flow = 0;
    for (const [, delta] of series) flow += delta;
    if (flow === 0) continue;
    const id = Number(idStr);
    const b = repoBucket(id);
    let arr = byBucket.get(b);
    if (!arr) byBucket.set(b, (arr = []));
    arr.push([id, flow]);
  }

  for (const [b, entries] of byBucket) {
    const shard = (await readView(`canonical/v2/repo-monthly/${b}.json`, RepoMonthlyShard, { bust: runId })) ?? {};
    for (const [id, flow] of entries) {
      const series = (shard[String(id)] ?? []).filter(([p]) => p !== month); // upsert → idempotent
      series.push([month, flow]);
      series.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      shard[String(id)] = series;
    }
    await putOwnedView({ runId, fencingToken }, `canonical/v2/repo-monthly/${b}.json`, shard);
  }

  // append the month's daily site totals to site-daily/<year> (heatmap source), upsert by date.
  const year = month.slice(0, 4);
  const site = (await readView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust: runId })) ?? { year, cells: [] };
  const cells = new Map<string, number>(site.cells.map(([d, t]) => [d, t]));
  for (const [date, total] of pending.daily_totals) cells.set(date, total);
  await putOwnedView({ runId, fencingToken }, `canonical/v2/site-daily/${year}.json`, {
    year,
    cells: [...cells.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)),
  });
}

/** One folded week: id + per-repo flow (Σ daily deltas of that repo whose date lands in the week). */
export interface WeekRow {
  week: string;
  perRepo: Map<number, number>;
}

/** PURE core (no I/O) of the week fold — the testable seam. Given the FROZEN month pendings that
 *  cover the candidate weeks plus the (exclusive) from-week and the last frozen month, return one
 *  WeekRow per ISO week W with W > fromWeekExclusive whose LAST day (Sunday) ≤ end-of-foldedMonth,
 *  CONTIGUOUSLY ascending (enumerated by stepping +7 days, so even an all-zero week is emitted to
 *  keep the watermark gap-free). Cross-month weeks naturally sum days from BOTH months' pendings
 *  because all days are collapsed into one date→delta map first. Repos with 0 week flow are dropped
 *  from perRepo (but the WeekRow itself stays so the watermark still advances past it). */
export function computeWeekRows(pendings: PendingPeriod[], fromWeekExclusive: string, foldedMonth: string): WeekRow[] {
  // collapse every pending's per_repo into date -> (id -> summed delta).
  const byDate = new Map<string, Map<number, number>>();
  for (const pending of pendings) {
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

async function foldWeeks(
  foldedThroughMonth: string,
  fromWeekExclusive: string,
  runId: string,
  fencingToken: number,
): Promise<string[]> {
  // Which frozen month pendings can hold a candidate week's days? From the month of the first
  // candidate week's start (day after fromWeek's Sunday) through the last frozen month, inclusive.
  // A boundary week straddling fromWeek's own month is impossible here (its days end on fromWeek's
  // Sunday, already folded), but monthsBetween starts at the first candidate Monday's month anyway.
  const firstMonday = addDays(sundayOfWeekId(fromWeekExclusive), 1);
  const lastFoldableDay = endOfMonth(foldedThroughMonth);
  if (firstMonday > lastFoldableDay) return []; // not even one full candidate week is frozen yet

  const months = monthsBetween(firstMonday, lastFoldableDay);
  const pendings: PendingPeriod[] = [];
  for (const m of months) {
    const pending = await readView(`canonical/v2/pending/${m}.json`, PendingPeriod, { bust: runId });
    if (pending) pendings.push(pending); // a month with no frozen pending contributes no days
  }

  const rows = computeWeekRows(pendings, fromWeekExclusive, foldedThroughMonth);
  if (rows.length === 0) return [];

  // group week flows by bucket, then upsert each affected repo-weekly shard once (same idempotent
  // pattern as the month fold: filter the week out, push, re-sort by period).
  const byBucket = new Map<number, WeekRow[]>();
  for (const row of rows) {
    const buckets = new Set<number>();
    for (const id of row.perRepo.keys()) buckets.add(repoBucket(id));
    for (const b of buckets) {
      let arr = byBucket.get(b);
      if (!arr) byBucket.set(b, (arr = []));
      arr.push(row);
    }
  }

  for (const [b, weekRows] of byBucket) {
    const shard = (await readView(`canonical/v2/repo-weekly/${b}.json`, RepoWeeklyShard, { bust: runId })) ?? {};
    for (const row of weekRows) {
      for (const [id, flow] of row.perRepo) {
        if (repoBucket(id) !== b) continue;
        const series = (shard[String(id)] ?? []).filter(([p]) => p !== row.week); // upsert → idempotent
        series.push([row.week, flow]);
        series.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
        shard[String(id)] = series;
      }
    }
    await putOwnedView({ runId, fencingToken }, `canonical/v2/repo-weekly/${b}.json`, shard);
  }

  return rows.map((r) => r.week); // ascending + contiguous; caller advances folded_through.week to last
}
