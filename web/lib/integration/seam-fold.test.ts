// Post-seam stock math (port of scripts/test-seam-fold.ts).
// The parity harness only covers the pre-seam no-op case, so this pins the seam-aware behaviour
// on tiny hand-built models: pre-seam periods use round(cumGross × d); post-seam periods add net
// on top of the FROZEN anchor (NOT × d), including negative net; and the year row derives its
// stock from the monthly window.  Pure math — no local files needed.
//   bun test lib/integration/seam-fold.test.ts
import { test, expect, describe } from "bun:test";
import { buildModel, type RawShards } from "../workflows/recompute/model";
import { computeRepoWindow, deriveYearWindow } from "../workflows/recompute/windows";

// seam_date 2026-05-30 → seam month 2026-05, seam week 2026-W22.
function model(monthly: Array<[string, number]>, d = 0.8) {
  const raw = {
    repos: { "1": { id: 1, owner: "o", owner_type: "User", name: "r", full_name: "o/r", current_stars: 150, d } },
    monthly: { "1": monthly },
    weekly: { "1": [] },
    recentDaily: { "1": [] },
    siteDailyByYear: {},
  } as unknown as RawShards;
  return buildModel(raw, "2026-05-30");
}

describe("seam-aware stock math (computeRepoWindow / deriveYearWindow)", () => {
  test("seam boundary resolves to month 2026-05, week 2026-W22", () => {
    expect(model([]).seam).toEqual({ month: "2026-05", week: "2026-W22" });
  });

  test("pre-seam gross × d, then post-seam net added on the anchor round(150×0.8)=120", () => {
    // 2026-04 = round((100)×0.8)=80; 2026-05 = round((150)×0.8)=120 (anchor); 2026-06 = 120 + 30 = 150.
    // The OLD uniform formula would give round((100+50+30)×0.8)=144 for 2026-06 — must NOT be that.
    const mw = computeRepoWindow(model([["2026-04", 100], ["2026-05", 50], ["2026-06", 30]]), "month");
    expect(mw.byRepo.get(1)!.map((r) => r.stock_est)).toEqual([80, 120, 150]);
  });

  test("negative post-seam net (cancellations) subtracts from the anchor", () => {
    const mw = computeRepoWindow(model([["2026-04", 100], ["2026-05", 50], ["2026-06", -10]]), "month");
    expect(mw.byRepo.get(1)!.map((r) => r.stock_est)).toEqual([80, 120, 110]);
  });

  test("year row: flow = Σ months, stock = last month's (seam-aware) stock", () => {
    const m = model([["2026-04", 100], ["2026-05", 50], ["2026-06", 30]]);
    const yw = deriveYearWindow(m, computeRepoWindow(m, "month"));
    expect(yw.byRepo.get(1)!.map((r) => [r.period, r.flow, r.stock_est])).toEqual([["2026", 180, 150]]);
  });
});
