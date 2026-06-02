// Post-seam stock math check (the parity harness only covers the pre-seam no-op case).
// Verifies: pre-seam periods use round(cumGross × d); post-seam periods add net on top of the
// frozen anchor (NOT × d), including negative net; year stock derives from the monthly window.
//   bun run scripts/test-seam-fold.ts
/* eslint-disable no-console */
import { buildModel, type RawShards } from "../lib/workflows/recompute/model";
import { computeRepoWindow, deriveYearWindow } from "../lib/workflows/recompute/windows";

let failures = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: got ${g} want ${w}`);
};

function model(monthly: Array<[string, number]>, d = 0.8) {
  const raw = {
    repos: { "1": { id: 1, owner: "o", owner_type: "User", name: "r", full_name: "o/r", current_stars: 150, d } },
    monthly: { "1": monthly },
    weekly: { "1": [] },
    recentDaily: { "1": [] },
    siteDailyByYear: {},
  } as unknown as RawShards;
  return buildModel(raw, "2026-05-30"); // seam month = 2026-05, seam week = 2026-W22
}

// seam boundary
eq("seam", model([]).seam, { month: "2026-05", week: "2026-W22" });

// pre-seam (≤2026-05) gross × d; post-seam (2026-06) net added on the anchor round(150×0.8)=120
{
  const mw = computeRepoWindow(model([["2026-04", 100], ["2026-05", 50], ["2026-06", 30]]), "month");
  eq("month stock (gross then +net)", mw.byRepo.get(1)!.map((r) => r.stock_est), [80, 120, 150]);
  // the OLD uniform formula would give round((100+50+30)×0.8)=144 for 2026-06 — must NOT be that.
}

// negative post-seam net (cancellations) subtracts from the anchor
{
  const mw = computeRepoWindow(model([["2026-04", 100], ["2026-05", 50], ["2026-06", -10]]), "month");
  eq("month stock (negative net)", mw.byRepo.get(1)!.map((r) => r.stock_est), [80, 120, 110]);
}

// year stock derives from the monthly window (straddle year 2026 resolved at month granularity)
{
  const m = model([["2026-04", 100], ["2026-05", 50], ["2026-06", 30]]);
  const yw = deriveYearWindow(m, computeRepoWindow(m, "month"));
  eq("year row (flow=Σmonths, stock=last month)", yw.byRepo.get(1)!.map((r) => [r.period, r.flow, r.stock_est]), [["2026", 180, 150]]);
}

console.log(failures === 0 ? "\nSEAM-FOLD MATH OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
