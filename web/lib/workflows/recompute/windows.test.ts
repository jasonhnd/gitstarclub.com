// Unit tests for the seam-aware per-window metric tables (windows.ts).
// Mirrors scripts/test-seam-fold.ts but as a bun:test suite, and adds coverage for the
// flow_rank tie-break, the straddle-year derivation, and org forward-fill carry across idle
// periods. All Models are tiny hand-built RawShards; seam_date "2026-05-30" fixes the gross/net
// boundary at seam month 2026-05 / seam week 2026-W22.
//   bun test lib/workflows/recompute/windows.test.ts
import { test, expect, describe } from "bun:test";
import { buildModel, seamPeriods, type RawShards, type RepoMeta } from "./model";
import { computeRepoWindow, computeOrgWindow, deriveYearWindow } from "./windows";

const SEAM_DATE = "2026-05-30"; // → seam month 2026-05, seam week 2026-W22

type RepoSpec = {
  id: number;
  owner: string;
  owner_type?: "User" | "Organization";
  current_stars: number;
  d: number;
  monthly?: Array<[string, number]>;
  weekly?: Array<[string, number]>;
};

/** Build a Model from a flat list of repo specs (no daily / site-daily needed for these tests). */
function makeModel(specs: RepoSpec[], seamDate = SEAM_DATE) {
  const repos: Record<string, RepoMeta> = {};
  const monthly: Record<string, Array<[string, number]>> = {};
  const weekly: Record<string, Array<[string, number]>> = {};
  const recentDaily: Record<string, []> = {};
  for (const s of specs) {
    const k = String(s.id);
    repos[k] = {
      id: s.id,
      owner: s.owner,
      owner_type: s.owner_type ?? "User",
      name: `r${s.id}`,
      full_name: `${s.owner}/r${s.id}`,
      current_stars: s.current_stars,
      d: s.d,
    };
    monthly[k] = s.monthly ?? [];
    weekly[k] = s.weekly ?? [];
    recentDaily[k] = [];
  }
  const raw = { repos, monthly, weekly, recentDaily, siteDailyByYear: {} } as unknown as RawShards;
  return buildModel(raw, seamDate);
}

describe("seamPeriods", () => {
  test("seam_date 2026-05-30 → seam month 2026-05, week 2026-W22 (last gross day is 05-29)", () => {
    expect(seamPeriods(SEAM_DATE)).toEqual({ month: "2026-05", week: "2026-W22" });
  });

  test("empty seam_date treats everything as pre-seam (gross)", () => {
    expect(seamPeriods("")).toEqual({ month: "9999-12", week: "9999-W99" });
  });
});

describe("computeRepoWindow — month (seam-aware stock)", () => {
  // d = 0.8, current_stars = 150. Pre-seam: round(cumGross × d). Post-seam: anchor + cumNet.
  // 2026-04 +100 → cumGross 100 → round(100×0.8)=80
  // 2026-05 +50  → cumGross 150 → round(150×0.8)=120   (this is the frozen anchor)
  // 2026-06 +30  → post-seam → anchor(120) + net(30) = 150   (NOT round(180×0.8)=144)
  test("pre-seam gross × d, then post-seam adds net on the frozen anchor", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-04", 100], ["2026-05", 50], ["2026-06", 30]] }]);
    const rows = computeRepoWindow(m, "month").byRepo.get(1)!;
    expect(rows.map((r) => r.period)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(rows.map((r) => r.stock_est)).toEqual([80, 120, 150]);
    // the OLD uniform formula round((100+50+30)×0.8)=144 must NOT appear post-seam.
    expect(rows.find((r) => r.period === "2026-06")!.stock_est).not.toBe(144);
    // cumgross is the running total = gross cumsum while pre-seam, gross+net once past the seam.
    expect(rows.map((r) => r.cumgross)).toEqual([100, 150, 180]);
  });

  test("negative post-seam net (cancellations) subtracts from the anchor", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-04", 100], ["2026-05", 50], ["2026-06", -10]] }]);
    const rows = computeRepoWindow(m, "month").byRepo.get(1)!;
    // anchor 120, net -10 → 110
    expect(rows.map((r) => r.stock_est)).toEqual([80, 120, 110]);
  });

  test("the anchor freezes at the FIRST post-seam period and accumulates net across multiple post-seam months", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-05", 200], ["2026-06", 30], ["2026-07", -5]] }]);
    const rows = computeRepoWindow(m, "month").byRepo.get(1)!;
    // 2026-05 pre-seam: cumGross 200 → round(160)=160 anchor. 2026-06: 160+30=190. 2026-07: 160+(30-5)=185.
    expect(rows.map((r) => r.stock_est)).toEqual([160, 190, 185]);
  });

  test("a series entirely after the seam anchors at 0 gross (anchor = round(0 × d) = 0)", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 99, d: 0.7, monthly: [["2026-06", 12], ["2026-07", 8]] }]);
    const rows = computeRepoWindow(m, "month").byRepo.get(1)!;
    // no pre-seam rows → anchor round(0×0.7)=0 → stock = 0+net
    expect(rows.map((r) => r.stock_est)).toEqual([12, 20]);
  });

  test("repos with no monthly series yield an empty row list", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 10, d: 1, monthly: [] }]);
    expect(computeRepoWindow(m, "month").byRepo.get(1)).toEqual([]);
  });
});

describe("computeRepoWindow — week (seam-aware stock)", () => {
  // Seam week is 2026-W22. W21 pre-seam, W23 post-seam. d = 0.5, current_stars = 80.
  test("week window applies the same pre/post-seam split at week granularity", () => {
    const m = makeModel([{ id: 1, owner: "o", current_stars: 80, d: 0.5, weekly: [["2026-W21", 40], ["2026-W22", 60], ["2026-W23", 20]] }]);
    const rows = computeRepoWindow(m, "week").byRepo.get(1)!;
    // W21: cumGross 40 → 20. W22 (= seam, still pre-seam): cumGross 100 → 50 (anchor). W23: 50+20=70.
    expect(rows.map((r) => r.period)).toEqual(["2026-W21", "2026-W22", "2026-W23"]);
    expect(rows.map((r) => r.stock_est)).toEqual([20, 50, 70]);
  });
});

describe("flow_rank — per-period tie-break (flow desc, cumgross desc, id asc)", () => {
  test("ties on flow break by cumgross desc, then ties on both break by id asc", () => {
    // Single shared period 2026-04 (pre-seam) so flow_rank is the only thing under test.
    // id 1: flow 50, cumgross 50
    // id 2: flow 50, cumgross 90  → higher cumgross ranks ABOVE id 1 despite equal flow
    // id 3: flow 50, cumgross 90  → ties id 2 on flow+cumgross → lower id (2) wins, id 3 next
    // id 4: flow 70             → highest flow ranks #1 overall
    const m = makeModel([
      { id: 1, owner: "o", current_stars: 0, d: 1, monthly: [["2026-04", 50]] },
      { id: 2, owner: "o", current_stars: 0, d: 1, monthly: [["2026-03", 40], ["2026-04", 50]] }, // cumgross 90 at 2026-04
      { id: 3, owner: "o", current_stars: 0, d: 1, monthly: [["2026-03", 40], ["2026-04", 50]] }, // cumgross 90 at 2026-04
      { id: 4, owner: "o", current_stars: 0, d: 1, monthly: [["2026-04", 70]] },
    ]);
    const win = computeRepoWindow(m, "month");
    const rankOf = (id: number) => win.byRepo.get(id)!.find((r) => r.period === "2026-04")!.flow_rank;
    // #1 highest flow (70) = id 4; then flow 50 group ordered by cumgross desc (90,90,50) then id asc (2,3,1)
    expect(rankOf(4)).toBe(1);
    expect(rankOf(2)).toBe(2);
    expect(rankOf(3)).toBe(3);
    expect(rankOf(1)).toBe(4);
    // sanity: the per-period bucket is what produces these ranks
    expect(win.rowsByPeriod.get("2026-04")!.map((c) => c.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe("deriveYearWindow — straddle year resolves via monthly", () => {
  test("year flow = Σ months; year stock = last month's (seam-aware) stock", () => {
    // 2026 straddles the seam: Jan–May pre-seam, June post-seam. d=0.8, current_stars=150.
    const m = makeModel([{ id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-04", 100], ["2026-05", 50], ["2026-06", 30]] }]);
    const yw = deriveYearWindow(m, computeRepoWindow(m, "month"));
    const rows = yw.byRepo.get(1)!;
    // single straddle year 2026: flow = 100+50+30 = 180; stock = last month (2026-06) stock = 150.
    expect(rows.map((r) => [r.period, r.flow, r.stock_est])).toEqual([["2026", 180, 150]]);
  });

  test("multiple years: each year's stock is its own last month; flows sum within the year", () => {
    const m = makeModel([
      {
        id: 1,
        owner: "o",
        current_stars: 150,
        d: 0.8,
        // 2025 fully pre-seam; 2026 straddles.
        monthly: [["2025-11", 100], ["2025-12", 50], ["2026-05", 25], ["2026-06", 30]],
      },
    ]);
    const yw = deriveYearWindow(m, computeRepoWindow(m, "month"));
    const rows = yw.byRepo.get(1)!;
    // 2025: flow 150, stock at 2025-12 = round((100+50)×0.8)=120.
    // 2026: flow 55, last month 2026-06 post-seam → anchor round((150+25)×0.8)=140 + 30 = 170.
    expect(rows.map((r) => [r.period, r.flow, r.stock_est])).toEqual([
      ["2025", 150, 120],
      ["2026", 55, 170],
    ]);
  });
});

describe("computeOrgWindow — forward-fill across idle periods", () => {
  test("idle member carries its stock forward; org stock = Σ members and endpoint = current_stars_sum", () => {
    // One owner "org", two repos. All data pre-seam (≤2026-05) so stock = round(cumGross × d) and
    // the endpoint lands on current_stars. d=1 keeps the arithmetic exact.
    //   repo 1: 2026-04 +30, 2026-05 +20  → stock 30, 50; current_stars 50
    //   repo 2: 2026-04 +70 ONLY (idle in 2026-05) → stock 70; current_stars 70
    // Global periods = [2026-04, 2026-05]. In 2026-05 repo 2 has no row → carry its 70 forward.
    const m = makeModel([
      { id: 1, owner: "org", owner_type: "Organization", current_stars: 50, d: 1, monthly: [["2026-04", 30], ["2026-05", 20]] },
      { id: 2, owner: "org", owner_type: "Organization", current_stars: 70, d: 1, monthly: [["2026-04", 70]] },
    ]);
    const repoWin = computeRepoWindow(m, "month");
    const org = computeOrgWindow(m, repoWin);
    const rows = org.byLogin.get("org")!;
    expect(rows.map((r) => r.period)).toEqual(["2026-04", "2026-05"]);
    // 2026-04: flow 30+70=100, stock 30+70=100. 2026-05: flow 20+0(idle)=20, stock 50+70(carry)=120.
    expect(rows.map((r) => [r.period, r.flow, r.stock_est])).toEqual([
      ["2026-04", 100, 100],
      ["2026-05", 20, 120],
    ]);
    // endpoint org stock = Σ members' current_stars = 50 + 70 = current_stars_sum.
    expect(m.orgs.get("org")!.current_stars_sum).toBe(120);
    expect(rows[rows.length - 1].stock_est).toBe(m.orgs.get("org")!.current_stars_sum);
  });

  test("a member appearing only in a later period does not back-fill earlier periods", () => {
    // repo 1 spans both periods; repo 2 first appears in 2026-05 → it is absent from the 2026-04 sum.
    const m = makeModel([
      { id: 1, owner: "org", owner_type: "Organization", current_stars: 50, d: 1, monthly: [["2026-04", 30], ["2026-05", 20]] },
      { id: 2, owner: "org", owner_type: "Organization", current_stars: 40, d: 1, monthly: [["2026-05", 40]] },
    ]);
    const org = computeOrgWindow(m, computeRepoWindow(m, "month"));
    const rows = org.byLogin.get("org")!;
    // 2026-04: only repo 1 → flow 30, stock 30.
    // 2026-05: flow = repo1 20 + repo2 40 = 60 (period flow, not stock); stock = repo1 50 + repo2 40 = 90.
    expect(rows.map((r) => [r.period, r.flow, r.stock_est])).toEqual([
      ["2026-04", 30, 30],
      ["2026-05", 60, 90],
    ]);
    expect(rows[rows.length - 1].stock_est).toBe(m.orgs.get("org")!.current_stars_sum);
  });

  test("two distinct owners are summed independently", () => {
    const m = makeModel([
      { id: 1, owner: "a", current_stars: 50, d: 1, monthly: [["2026-04", 30], ["2026-05", 20]] },
      { id: 2, owner: "b", current_stars: 70, d: 1, monthly: [["2026-04", 70]] },
    ]);
    const org = computeOrgWindow(m, computeRepoWindow(m, "month"));
    // owner "a": both periods. owner "b": only 2026-04 (no carry beyond its own first→last span... but
    // global periods include 2026-05, so b carries its 70 forward into 2026-05 as an idle period).
    expect(org.byLogin.get("a")!.map((r) => [r.period, r.flow, r.stock_est])).toEqual([
      ["2026-04", 30, 30],
      ["2026-05", 20, 50],
    ]);
    expect(org.byLogin.get("b")!.map((r) => [r.period, r.flow, r.stock_est])).toEqual([
      ["2026-04", 70, 70],
      ["2026-05", 0, 70],
    ]);
    // each owner's endpoint equals its own current_stars_sum.
    expect(org.byLogin.get("a")!.at(-1)!.stock_est).toBe(m.orgs.get("a")!.current_stars_sum);
    expect(org.byLogin.get("b")!.at(-1)!.stock_est).toBe(m.orgs.get("b")!.current_stars_sum);
  });
});
