// Unit tests for the rank derivation layer (ranks.ts). Build synthetic Models, run them
// through computeRepoWindow/computeOrgWindow, and assert the matrix/all-time/growth/newcomers
// shapes + ordering rules described in RANKING §4 (prev_rank from the FULL prior-period ranking,
// numeric repo-id tie-break, text org-login tie-break, 20k growth floor, milestone newcomers).
import { test, expect, describe } from "bun:test";
import { buildModel, type RawShards, type RepoMeta } from "./model";
import { computeRepoWindow, computeOrgWindow } from "./windows";
import { allTime, growth, newcomers, orgRankMatrix, repoRankMatrix } from "./ranks";

const GEN = "2026-06-03T00:00:00Z";

// Minimal repo dimension row. d defaults to 1 so pre-seam stock_est = round(cumGross × 1) = cumGross.
function repo(
  id: number,
  monthly: Array<[string, number]>,
  extra: Partial<RepoMeta> = {},
): { meta: RepoMeta; monthly: Array<[string, number]> } {
  const owner = extra.owner ?? `o${id}`;
  const meta: RepoMeta = {
    id,
    owner,
    owner_type: extra.owner_type ?? "User",
    name: `r${id}`,
    full_name: `${owner}/r${id}`,
    current_stars: extra.current_stars ?? 0,
    d: extra.d ?? 1,
    ...extra,
  };
  return { meta, monthly };
}

// Build a Model from repo specs. seamDate "" → seam month 9999-12, so every period is pre-seam
// and stock_est = round(cumGross × d). Lets tests reason about stock with plain cumulative sums.
function model(specs: Array<ReturnType<typeof repo>>, seamDate = ""): ReturnType<typeof buildModel> {
  const repos: Record<string, RepoMeta> = {};
  const monthly: Record<string, Array<[string, number]>> = {};
  for (const s of specs) {
    repos[String(s.meta.id)] = s.meta;
    monthly[String(s.meta.id)] = s.monthly;
  }
  const raw = {
    repos,
    monthly,
    weekly: {},
    recentDaily: {},
    siteDailyByYear: {},
  } as unknown as RawShards;
  return buildModel(raw, seamDate);
}

describe("repoRankMatrix", () => {
  test("emits flow + stock views keyed by period with correct item shape", () => {
    const m = model([
      repo(1, [["2026-01", 50]]),
      repo(2, [["2026-01", 30]]),
    ]);
    const rw = computeRepoWindow(m, "month");
    const out = repoRankMatrix(rw, "month", GEN);

    expect([...out.keys()].sort()).toEqual([
      "rank/month/2026-01/repo/flow.json",
      "rank/month/2026-01/repo/stock.json",
    ]);

    const flow = out.get("rank/month/2026-01/repo/flow.json")!;
    expect(flow.meta).toEqual({
      window: "month",
      period: "2026-01",
      dim: "repo",
      metric: "flow",
      generated_at: GEN,
    });
    // id 1 (flow 50) ranks above id 2 (flow 30); prev_rank null in first period.
    expect(flow.items).toEqual([
      { rank: 1, value: 50, prev_rank: null, id: 1 },
      { rank: 2, value: 30, prev_rank: null, id: 2 },
    ]);
  });

  test("caps each period at top-100", () => {
    // 102 repos, distinct descending flow so order is deterministic by flow alone.
    const specs = Array.from({ length: 102 }, (_, i) =>
      repo(i + 1, [["2026-01", 1000 - i]]),
    );
    const rw = computeRepoWindow(model(specs), "month");
    const out = repoRankMatrix(rw, "month", GEN);
    const items = out.get("rank/month/2026-01/repo/flow.json")!.items;
    expect(items.length).toBe(100);
    expect(items[0]).toMatchObject({ rank: 1, id: 1, value: 1000 });
    expect(items[99]).toMatchObject({ rank: 100, id: 100, value: 901 });
  });

  test("prev_rank reflects the FULL prior-period ranking, not just top-100", () => {
    // Period A: a "needle" repo sits at rank 101 (outside top-100). Period B: it jumps to rank 1.
    // prev_rank in B must be 101 — i.e. resolved against A's complete ranking, not A's top-100 slice.
    const NEEDLE = 999;
    const others = Array.from({ length: 100 }, (_, i) =>
      // ids 1..100, large flow in A (so they outrank the needle), tiny flow in B.
      repo(i + 1, [
        ["2026-01", 1000 - i], // A: 1000..901  → ranks 1..100
        ["2026-02", 1], // B: all tie at flow 1, beaten by the needle
      ]),
    );
    const needle = repo(NEEDLE, [
      ["2026-01", 1], // A: lowest flow → rank 101 (full ranking)
      ["2026-02", 5000], // B: highest flow → rank 1
    ]);
    const rw = computeRepoWindow(model([...others, needle]), "month");
    const out = repoRankMatrix(rw, "month", GEN);

    const a = out.get("rank/month/2026-01/repo/flow.json")!.items;
    expect(a.length).toBe(100); // needle is excluded from A's top-100
    expect(a.some((it) => it.id === NEEDLE)).toBe(false);

    const b = out.get("rank/month/2026-02/repo/flow.json")!.items;
    const needleB = b.find((it) => it.id === NEEDLE)!;
    expect(needleB.rank).toBe(1);
    expect(needleB.prev_rank).toBe(101); // ← the crux: full-rank position from period A
  });

  test("flow tie-break: (flow desc, stock_est desc, NUMERIC id asc)", () => {
    // Three repos, all flow 100 in 2026-01. Distinguish by stock then numeric id.
    // To vary stock independently of the tie-period flow, give a prior month of gross.
    // stock_est at 2026-01 = cumGross through 2026-01 (d=1).
    const m = model([
      // id 2: stock 100 (no prior) → lowest stock among the two 100-stock... craft explicitly below
      repo(2, [["2026-01", 100]]), // stock 100
      repo(10, [["2025-12", 50], ["2026-01", 100]]), // stock 150 (highest)
      repo(3, [["2026-01", 100]]), // stock 100, ties id 2 on stock → numeric id 3 > 2
    ]);
    const rw = computeRepoWindow(m, "month");
    const items = repoRankMatrix(rw, "month", GEN).get("rank/month/2026-01/repo/flow.json")!.items;
    // Order: id 10 (stock 150) first; then id 2 vs id 3 both stock 100 → numeric id asc (2 before 3).
    expect(items.map((it) => it.id)).toEqual([10, 2, 3]);
    expect(items.map((it) => it.value)).toEqual([100, 100, 100]);
  });

  test("numeric (not lexical) id tie-break orders 9 before 100", () => {
    // Lexical string sort would place "100" before "9"; numeric must place 9 before 100.
    const m = model([
      repo(9, [["2026-01", 100]]),
      repo(100, [["2026-01", 100]]),
    ]);
    const rw = computeRepoWindow(m, "month");
    const items = repoRankMatrix(rw, "month", GEN).get("rank/month/2026-01/repo/flow.json")!.items;
    expect(items.map((it) => it.id)).toEqual([9, 100]);
  });
});

describe("orgRankMatrix", () => {
  test("ranks by login string tie-break and emits login items", () => {
    // Two orgs tie on flow (100) and stock (100) in 2026-01 → login string asc: "alpha" < "beta".
    const m = model([
      repo(1, [["2026-01", 100]], { owner: "beta", owner_type: "Organization" }),
      repo(2, [["2026-01", 100]], { owner: "alpha", owner_type: "Organization" }),
    ]);
    const rw = computeRepoWindow(m, "month");
    const ow = computeOrgWindow(m, rw);
    const out = orgRankMatrix(ow, "month", GEN);

    expect(out.has("rank/month/2026-01/org/flow.json")).toBe(true);
    const items = out.get("rank/month/2026-01/org/flow.json")!.items;
    expect(items).toEqual([
      { rank: 1, value: 100, prev_rank: null, login: "alpha" },
      { rank: 2, value: 100, prev_rank: null, login: "beta" },
    ]);
  });
});

describe("allTime", () => {
  test("repo top-100 by current_stars desc then id asc; prev_rank null", () => {
    const m = model([
      repo(5, [], { current_stars: 100 }),
      repo(3, [], { current_stars: 200 }),
      repo(8, [], { current_stars: 100 }), // ties id 5 on stars → id asc: 5 before 8
    ]);
    const out = allTime(m, GEN);
    const repoView = out.get("rank/all-time/repo/stock.json")!;
    expect(repoView.meta).toEqual({
      window: "all",
      period: "all",
      dim: "repo",
      metric: "stock",
      generated_at: GEN,
    });
    expect(repoView.items).toEqual([
      { rank: 1, id: 3, value: 200, prev_rank: null },
      { rank: 2, id: 5, value: 100, prev_rank: null },
      { rank: 3, id: 8, value: 100, prev_rank: null },
    ]);
  });

  test("excludes a higher-star historical repository from current all-time ranks", () => {
    const m = model([
      repo(1, [], { current_stars: 100, active: true }),
      repo(2, [], { current_stars: 1_000_000, active: false }),
    ]);
    expect(allTime(m, GEN).get("rank/all-time/repo/stock.json")!.items).toEqual([
      { rank: 1, id: 1, value: 100, prev_rank: null },
    ]);
  });

  test("org top by current_stars_sum desc then login asc", () => {
    const m = model([
      // org "z" sums to 300; orgs "a" and "m" each sum to 150 → login asc a before m.
      repo(1, [], { owner: "z", owner_type: "Organization", current_stars: 300 }),
      repo(2, [], { owner: "m", owner_type: "Organization", current_stars: 150 }),
      repo(3, [], { owner: "a", owner_type: "Organization", current_stars: 150 }),
    ]);
    const orgView = allTime(m, GEN).get("rank/all-time/org/stock.json")!;
    expect(orgView.items).toEqual([
      { rank: 1, login: "z", value: 300, prev_rank: null },
      { rank: 2, login: "a", value: 150, prev_rank: null },
      { rank: 3, login: "m", value: 150, prev_rank: null },
    ]);
  });
});

describe("growth", () => {
  test("applies 20k base floor, flow>0 filter, rate, and (rate desc, flow desc, id asc) order", () => {
    // base = previous period's stock_est. With d=1 stock_est = cumulative gross.
    // big1: base 25000 (prior month), flow 5000 in 2026-02 → rate 20.0, included.
    // big2: base 50000, flow 5000 → rate 10.0, included (lower rate than big1).
    // small: base 19999 (< 20k floor) → excluded despite huge flow.
    // flat: base 30000, flow 0 → excluded (flow not > 0).
    const m = model([
      repo(1, [["2026-01", 25000], ["2026-02", 5000]]), // big1
      repo(2, [["2026-01", 50000], ["2026-02", 5000]]), // big2
      repo(3, [["2026-01", 19999], ["2026-02", 9000]]), // small → floored out
      repo(4, [["2026-01", 30000], ["2026-02", 0]]), // flat → flow 0 out
    ]);
    const rw = computeRepoWindow(m, "month");
    const out = growth(rw, "month", GEN);
    const view = out.get("rank/month/2026-02/repo/growth.json")!;
    expect(view.meta.metric).toBe("growth");

    expect(view.items).toEqual([
      { rank: 1, id: 1, value: 5000, base: 25000, rate: 20, prev_rank: null },
      { rank: 2, id: 2, value: 5000, base: 50000, rate: 10, prev_rank: null },
    ]);
    // explicit: the small repo (base 19999) is absent because of the 20k floor.
    expect(view.items.some((it) => it.id === 3)).toBe(false);
    expect(view.items.some((it) => it.id === 4)).toBe(false);
  });

  test("rate = round(flow/base*1000)/10 (one decimal place)", () => {
    // base 20000, flow 1234 → 1234/20000 = 0.0617 → *1000 = 61.7 → round 62 → /10 = 6.2
    const m = model([repo(1, [["2026-01", 20000], ["2026-02", 1234]])]);
    const rw = computeRepoWindow(m, "month");
    const view = growth(rw, "month", GEN).get("rank/month/2026-02/repo/growth.json")!;
    expect(view.items[0]).toMatchObject({ base: 20000, value: 1234, rate: 6.2 });
  });
});

describe("newcomers", () => {
  test("groups crossed_10k by month slice (7 chars), sorts by stars desc then id asc, carries date", () => {
    const m = model([
      repo(1, [], { current_stars: 12000, crossed_10k: "2026-03-15" }),
      repo(2, [], { current_stars: 15000, crossed_10k: "2026-03-28" }), // same month, more stars → first
      repo(3, [], { current_stars: 9000, crossed_10k: "2026-04-01" }), // different month
      repo(4, [], { current_stars: 5000 }), // no crossing → excluded
    ]);
    const out = newcomers(m, "month", GEN);

    const mar = out.get("rank/month/2026-03/repo/new.json")!;
    expect(mar.meta).toMatchObject({ window: "month", period: "2026-03", metric: "new" });
    expect(mar.items).toEqual([
      { rank: 1, id: 2, value: 15000, date: "2026-03-28", prev_rank: null },
      { rank: 2, id: 1, value: 12000, date: "2026-03-15", prev_rank: null },
    ]);

    const apr = out.get("rank/month/2026-04/repo/new.json")!;
    expect(apr.items).toEqual([
      { rank: 1, id: 3, value: 9000, date: "2026-04-01", prev_rank: null },
    ]);

    // repo 4 never appears (no crossed_10k milestone).
    const allItems = [...out.values()].flatMap((v) => v.items);
    expect(allItems.some((it) => it.id === 4)).toBe(false);
  });

  test("year window groups crossed_10k by 4-char year slice", () => {
    const m = model([
      repo(1, [], { current_stars: 12000, crossed_10k: "2025-11-10" }),
      repo(2, [], { current_stars: 20000, crossed_10k: "2025-02-02" }), // same year, more stars
      repo(3, [], { current_stars: 30000, crossed_10k: "2026-01-01" }),
    ]);
    const out = newcomers(m, "year", GEN);
    expect(out.has("rank/year/2025/repo/new.json")).toBe(true);
    expect(out.has("rank/year/2026/repo/new.json")).toBe(true);

    const y2025 = out.get("rank/year/2025/repo/new.json")!.items;
    expect(y2025.map((it) => it.id)).toEqual([2, 1]); // 20000 before 12000
  });
});
