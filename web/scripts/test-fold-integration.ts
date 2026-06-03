// End-to-end fold integration test (local, no Blob, no live data touched).
// There is no closed month in real data yet (folded_through=2026-05, current=2026-06), so this
// synthesizes a closed post-seam month 2026-06 (with cross-week net deltas) over the REAL local
// canonical/v2 shards, applies the actual fold cores (month flow sum + computeWeekRows), runs the
// seam-aware recompute, and asserts the folded month/week land in the view matrix with the correct
// seam-aware stock (anchor + net, NOT × d) while pre-seam periods stay unchanged.
//   bun run scripts/test-fold-integration.ts
/* eslint-disable no-console */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildModel, computeRepoWindow, computeAllViews, type RawShards } from "../lib/workflows/recompute";
import { computeWeekRows } from "../lib/workflows/steps/fold";
import { weekIdOf } from "../lib/workflows/steps/week-dates";

const root = fileURLToPath(new URL("../../pipeline/data/v2/canonical/v2", import.meta.url));
const J = (rel: string) => JSON.parse(readFileSync(`${root}/${rel}`, "utf8"));
const BUCKETS = 32;
const merge = <T>(sub: string): Record<string, T> => {
  const out: Record<string, T> = {};
  for (let b = 0; b < BUCKETS; b++) Object.assign(out, J(`${sub}/${b}.json`));
  return out;
};

let failures = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
};

const meta = J("meta.json") as { seam_date: string; folded_through: { month: string; week: string } };
const siteDailyByYear: RawShards["siteDailyByYear"] = {};
for (const f of readdirSync(`${root}/site-daily`)) {
  const o = J(`site-daily/${f}`);
  siteDailyByYear[o.year] = o;
}
const baseRaw: RawShards = {
  repos: merge("repos"),
  monthly: merge("repo-monthly"),
  weekly: merge("repo-weekly"),
  recentDaily: merge("repo-recent-daily"),
  siteDailyByYear,
};

// --- baseline recompute (pre-fold): find a repo with a 2026-05 anchor row ---
const baseModel = buildModel(structuredClone(baseRaw), meta.seam_date);
const baseMonth = computeRepoWindow(baseModel, "month");
const TRACK = Number(
  [...baseModel.ids].find((id) => (baseMonth.byRepo.get(id) ?? []).some((r) => r.period === "2026-05")),
);
const TRACK2 = Number(
  [...baseModel.ids].find((id) => id !== TRACK && (baseMonth.byRepo.get(id) ?? []).some((r) => r.period === "2026-05")),
);
const anchor = baseMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-05")!.stock_est;
console.log(`tracked repos: ${TRACK} (anchor stock@2026-05=${anchor}), ${TRACK2}; seam=${meta.seam_date} folded_through=${JSON.stringify(meta.folded_through)}`);

// --- synthesize a CLOSED 2026-06 pending: net daily deltas (incl. negative), across two ISO weeks ---
// 2026-06-02 (Tue) + 2026-06-03 (Wed) ∈ 2026-W23; 2026-06-09 (Tue) ∈ 2026-W24.
const juneDeltas: Record<string, Array<[string, number]>> = {
  [TRACK]: [["2026-06-02", 50], ["2026-06-09", -10]], // net = 40; W23=+50, W24=-10
  [TRACK2]: [["2026-06-03", 30]], //                     net = 30; W23=+30
};
const trackJuneNet = 40;
const dailyTotals = new Map<string, number>();
for (const series of Object.values(juneDeltas)) for (const [d, v] of series) dailyTotals.set(d, (dailyTotals.get(d) ?? 0) + v);
const pending = {
  period: "2026-06",
  frozen_at: new Date().toISOString(),
  daily_totals: [...dailyTotals.entries()].sort(),
  per_repo: juneDeltas,
};

// --- apply the actual fold cores to a clone of the raw shards ---
const foldedRaw = structuredClone(baseRaw);
const byPeriod = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
// month fold: Σ June deltas per repo → upsert [2026-06, flow] into monthly
for (const [idStr, series] of Object.entries(juneDeltas)) {
  const flow = series.reduce((s, [, d]) => s + d, 0);
  const m = (foldedRaw.monthly[idStr] ?? []).filter(([p]) => p !== "2026-06") as Array<[string, number]>;
  m.push(["2026-06", flow]);
  m.sort(byPeriod);
  foldedRaw.monthly[idStr] = m;
}
// week fold: the real pure core → upsert [week, flow] into weekly
const weekRows = computeWeekRows([pending], meta.folded_through.week, "2026-06");
for (const row of weekRows) {
  for (const [id, flow] of row.perRepo) {
    const w = (foldedRaw.weekly[String(id)] ?? []).filter(([p]) => p !== row.week) as Array<[string, number]>;
    w.push([row.week, flow]);
    w.sort(byPeriod);
    foldedRaw.weekly[String(id)] = w;
  }
}
const foldedThroughWeek = weekRows.length ? weekRows[weekRows.length - 1].week : meta.folded_through.week;

// --- recompute over the folded model ---
const foldedModel = buildModel(foldedRaw, meta.seam_date);
const foldedMonth = computeRepoWindow(foldedModel, "month");
const foldedWeek = computeRepoWindow(foldedModel, "week");
const trackJuneRow = foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-06")!;
const w23 = weekIdOf("2026-06-02"); // 2026-W23

// --- assertions: the folded post-seam month/week are seam-aware (anchor + net, NOT × d) ---
eq("month 2026-06 flow (Σ net)", trackJuneRow.flow, trackJuneNet);
eq("month 2026-06 stock = anchor + net (seam-aware)", trackJuneRow.stock_est, anchor + trackJuneNet);
eq("month 2026-05 anchor unchanged after fold", foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-05")!.stock_est, anchor);
const w23Row = (foldedWeek.byRepo.get(TRACK) ?? []).find((r) => r.period === w23);
eq("week W23 flow folded (=+50)", w23Row?.flow, 50);
eq("week W23 stock = weekAnchor + 50 (seam-aware)", w23Row?.stock_est, weekAnchor(TRACK) + 50);

function weekAnchor(id: number): number {
  // last pre-seam (≤ seam week) weekly stock = the frozen week anchor for post-seam weeks.
  const rows = computeRepoWindow(baseModel, "week").byRepo.get(id) ?? [];
  const preSeam = rows.filter((r) => r.period <= meta.folded_through.week);
  return preSeam.length ? preSeam[preSeam.length - 1].stock_est : 0;
}

// --- full view matrix includes the folded month + week ---
const { views } = computeAllViews(foldedModel, { gen: "TEST", seamDate: meta.seam_date, foldedThrough: { month: "2026-06", week: foldedThroughWeek } });
eq("rank/month/2026-06/repo/flow.json produced", views.has("rank/month/2026-06/repo/flow.json"), true);
eq("rank/week/2026-W23/repo/flow.json produced", views.has(`rank/week/${w23}/repo/flow.json`), true);

// --- pre-seam regression: an old month's stock unchanged vs baseline ---
const oldBase = baseMonth.byRepo.get(TRACK)!.find((r) => r.period === "2024-12") ?? baseMonth.byRepo.get(TRACK)![0];
const oldFolded = foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === oldBase.period)!;
eq(`pre-seam ${oldBase.period} stock unchanged`, oldFolded.stock_est, oldBase.stock_est);

console.log(failures === 0 ? "\nFOLD INTEGRATION OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
