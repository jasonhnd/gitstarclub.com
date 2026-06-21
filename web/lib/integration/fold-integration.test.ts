// End-to-end fold integration (port of scripts/test-fold-integration.ts).
// No closed month exists in real data yet (folded_through=2026-05, current=2026-06), so this
// synthesizes a CLOSED post-seam month 2026-06 (with cross-week net deltas, incl. negative) over
// the REAL local canonical/v2 shards, applies the actual fold cores (month flow Σ + computeWeekRows),
// runs the seam-aware recompute, and asserts the folded month/week land in the view matrix with the
// correct seam-aware stock (anchor + net, NOT × d) while pre-seam periods stay unchanged.
// Reads local files → skipped when pipeline/data is absent.
//   bun test lib/integration/fold-integration.test.ts
import { test, expect, describe } from "bun:test";
import { buildModel, computeRepoWindow, computeAllViews, type RawShards } from "../workflows/recompute";
import { computeWeekRows } from "../workflows/steps/fold";
import { weekIdOf } from "../workflows/steps/week-dates";
import { CANON, LOCAL_DATA_PRESENT, loadCanonMeta, loadRawShards } from "./local-data";

interface FoldFixture {
  TRACK: number;
  TRACK2: number;
  anchor: number; // tracked repo's 2026-05 stock_est (the frozen seam anchor)
  trackJuneNet: number; // Σ of TRACK's synthetic June deltas
  trackJuneRow: { period: string; flow: number; stock_est: number };
  month05AfterFold: number; // TRACK's 2026-05 stock after fold (must == anchor)
  w23: string; // weekIdOf("2026-06-02") = 2026-W23
  w23Flow: number | undefined;
  w23Stock: number | undefined;
  w23WeekAnchor: number; // last pre-seam weekly stock for TRACK
  hasMonthView: boolean;
  hasWeekView: boolean;
  oldPeriod: string;
  oldBaseStock: number;
  oldFoldedStock: number;
}

const byPeriod = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** Build the whole fold→recompute fixture once (the body of the old script's main()). */
function buildFixture(): FoldFixture {
  const meta = loadCanonMeta();
  const baseRaw: RawShards = loadRawShards();

  // baseline recompute (pre-fold): find two distinct repos that have a 2026-05 anchor row.
  const baseModel = buildModel(structuredClone(baseRaw), meta.seam_date);
  const baseMonth = computeRepoWindow(baseModel, "month");
  const TRACK = Number([...baseModel.ids].find((id) => (baseMonth.byRepo.get(id) ?? []).some((r) => r.period === "2026-05")));
  const TRACK2 = Number(
    [...baseModel.ids].find((id) => id !== TRACK && (baseMonth.byRepo.get(id) ?? []).some((r) => r.period === "2026-05")),
  );
  const anchor = baseMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-05")!.stock_est;

  // synthesize a CLOSED 2026-06 pending: net daily deltas (incl. negative) across two ISO weeks.
  // 2026-06-02 (Tue) + 2026-06-03 (Wed) ∈ 2026-W23; 2026-06-09 (Tue) ∈ 2026-W24.
  const juneDeltas: Record<string, Array<[string, number]>> = {
    [TRACK]: [["2026-06-02", 50], ["2026-06-09", -10]], // net = 40; W23=+50, W24=-10
    [TRACK2]: [["2026-06-03", 30]], //                     net = 30; W23=+30
  };
  const trackJuneNet = 40;
  const dailyTotals = new Map<string, number>();
  for (const series of Object.values(juneDeltas))
    for (const [d, v] of series) dailyTotals.set(d, (dailyTotals.get(d) ?? 0) + v);
  const pending = {
    period: "2026-06",
    frozen_at: new Date().toISOString(),
    daily_totals: [...dailyTotals.entries()].sort(),
    per_repo: juneDeltas,
  };

  // apply the actual fold cores to a clone of the raw shards.
  const foldedRaw = structuredClone(baseRaw);
  // month fold: Σ June deltas per repo → upsert [2026-06, flow] into monthly.
  for (const [idStr, series] of Object.entries(juneDeltas)) {
    const flow = series.reduce((s, [, d]) => s + d, 0);
    const m = (foldedRaw.monthly[idStr] ?? []).filter(([p]) => p !== "2026-06") as Array<[string, number]>;
    m.push(["2026-06", flow]);
    m.sort(byPeriod);
    foldedRaw.monthly[idStr] = m;
  }
  // week fold: the real pure core → upsert [week, flow] into weekly.
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

  // recompute over the folded model.
  const foldedModel = buildModel(foldedRaw, meta.seam_date);
  const foldedMonth = computeRepoWindow(foldedModel, "month");
  const foldedWeek = computeRepoWindow(foldedModel, "week");
  const trackJuneRow = foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-06")!;
  const w23 = weekIdOf("2026-06-02"); // 2026-W23

  // last pre-seam (≤ seam week) weekly stock = the frozen week anchor for post-seam weeks.
  const weekAnchor = (id: number): number => {
    const rows = computeRepoWindow(baseModel, "week").byRepo.get(id) ?? [];
    const preSeam = rows.filter((r) => r.period <= meta.folded_through.week);
    return preSeam.length ? preSeam[preSeam.length - 1].stock_est : 0;
  };
  const w23Row = (foldedWeek.byRepo.get(TRACK) ?? []).find((r) => r.period === w23);

  // full view matrix includes the folded month + week.
  const { views } = computeAllViews(foldedModel, {
    gen: "TEST",
    seamDate: meta.seam_date,
    foldedThrough: { month: "2026-06", week: foldedThroughWeek },
  });

  // pre-seam regression: an old month's stock unchanged vs baseline.
  const oldBase = baseMonth.byRepo.get(TRACK)!.find((r) => r.period === "2024-12") ?? baseMonth.byRepo.get(TRACK)![0];
  const oldFolded = foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === oldBase.period)!;

  return {
    TRACK,
    TRACK2,
    anchor,
    trackJuneNet,
    trackJuneRow: { period: trackJuneRow.period, flow: trackJuneRow.flow, stock_est: trackJuneRow.stock_est },
    month05AfterFold: foldedMonth.byRepo.get(TRACK)!.find((r) => r.period === "2026-05")!.stock_est,
    w23,
    w23Flow: w23Row?.flow,
    w23Stock: w23Row?.stock_est,
    w23WeekAnchor: weekAnchor(TRACK),
    hasMonthView: views.has("rank/month/2026-06/repo/flow.json"),
    hasWeekView: views.has(`rank/week/${w23}/repo/flow.json`),
    oldPeriod: oldBase.period,
    oldBaseStock: oldBase.stock_est,
    oldFoldedStock: oldFolded.stock_est,
  };
}

if (!LOCAL_DATA_PRESENT) {
  console.warn(`[fold-integration.test] SKIP: local pipeline data not found under ${CANON} — fold integration not run.`);
  test.skip("fold integration requires local pipeline data", () => {});
} else {
  describe("fold → recompute integration (synthetic closed 2026-06 over real shards)", () => {
  const f = buildFixture();

  test("two distinct repos with a 2026-05 anchor were found", () => {
    expect(Number.isFinite(f.TRACK) && Number.isFinite(f.TRACK2) && f.TRACK !== f.TRACK2).toBe(true);
  });

  test("month 2026-06 flow = Σ net deltas", () => {
    expect(f.trackJuneRow.flow).toBe(f.trackJuneNet);
  });

  test("month 2026-06 stock = anchor + net (seam-aware, NOT × d)", () => {
    expect(f.trackJuneRow.stock_est).toBe(f.anchor + f.trackJuneNet);
  });

  test("month 2026-05 anchor unchanged after fold", () => {
    expect(f.month05AfterFold).toBe(f.anchor);
  });

  test("week W23 flow folded (= +50)", () => {
    expect(f.w23Flow).toBe(50);
  });

  test("week W23 stock = weekAnchor + 50 (seam-aware)", () => {
    expect(f.w23Stock).toBe(f.w23WeekAnchor + 50);
  });

  test("full view matrix includes rank/month/2026-06/repo/flow.json", () => {
    expect(f.hasMonthView).toBe(true);
  });

  test(`full view matrix includes rank/week/<W23>/repo/flow.json`, () => {
    expect(f.hasWeekView).toBe(true);
  });

  test("pre-seam month stock unchanged vs baseline", () => {
    expect(f.oldFoldedStock).toBe(f.oldBaseStock);
  });
  });
}
