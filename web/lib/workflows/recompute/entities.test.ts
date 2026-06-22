// Unit tests for entity + lookup views (entities.ts). Builds a tiny synthetic Model,
// runs the real seam-aware windows (windows.ts), then asserts the entity shapes precompute emits.
import { test, expect, describe } from "bun:test";
import { buildModel, type RawShards } from "./model";
import { computeRepoWindow, computeOrgWindow } from "./windows";
import { repoEntities, orgEntities, lookups, searchIndex } from "./entities";

// Two repos under org "alpha". Seam month = 2026-05, so 2026-06 is post-seam:
//   repo 10 (d=0.8): gross 100 → stock round(100*0.8)=80; 2026-05 +50 → round(150*0.8)=120;
//                    2026-06 +30 (post-seam net) → anchor 120 + 30 = 150 (= current_stars).
//   repo 30 (d=1):   2026-04 +40 → 40; 2026-05 +20 → 60 (= current_stars; no post-seam row).
function syntheticModel(): ReturnType<typeof buildModel> {
  const raw: RawShards = {
    repos: {
      "10": {
        id: 10, owner: "alpha", owner_type: "Organization", name: "one", full_name: "alpha/one",
        description: "first", language: "TypeScript", languages: [{ name: "TypeScript", size: 1200, color: "#3178c6" }, { name: "JavaScript", size: 300, color: "#f1e05a" }], topics: ["cli"], created_at: "2020-01-15T09:00:00Z",
        current_stars: 150, is_archived: false, crossed_10k: "2024-03-01", d: 0.8,
      },
      "30": {
        id: 30, owner: "alpha", owner_type: "Organization", name: "two", full_name: "alpha/two",
        current_stars: 60, d: 1,
      },
    },
    monthly: {
      "10": [["2026-04", 100], ["2026-05", 50], ["2026-06", 30]],
      "30": [["2026-04", 40], ["2026-05", 20]],
    },
    weekly: { "10": [], "30": [] },
    recentDaily: {
      "10": [["2026-06-01", 10], ["2026-06-02", 20]],
      "30": [["2026-06-01", 5]],
    },
    siteDailyByYear: {},
  } as unknown as RawShards;
  return buildModel(raw, "2026-05-30"); // seam: month 2026-05, week 2026-W22
}

describe("repoEntities", () => {
  const model = syntheticModel();
  const monthWin = computeRepoWindow(model, "month");
  const { views, anchorDrift } = repoEntities(model, monthWin);

  test("emits one entity/repo/<id>.json view per repo (ids ascending iteration)", () => {
    expect([...views.keys()]).toEqual(["entity/repo/10.json", "entity/repo/30.json"]);
  });

  test("repo view carries identity, milestones, and trimmed created_at", () => {
    const e = views.get("entity/repo/10.json")!;
    expect(e.id).toBe(10);
    expect(e.full_name).toBe("alpha/one");
    expect(e.language).toBe("TypeScript");
    expect(e.languages).toEqual([{ name: "TypeScript", size: 1200, color: "#3178c6" }, { name: "JavaScript", size: 300, color: "#f1e05a" }]);
    expect(e.topics).toEqual(["cli"]);
    expect(e.created_at).toBe("2020-01-15"); // sliced to YYYY-MM-DD
    expect(e.milestones).toEqual({ crossed_10k: "2024-03-01", crossed_50k: null, crossed_100k: null });
  });

  test("curve.monthly = [[period, flow, stock]] with seam-aware anchored stock", () => {
    const e = views.get("entity/repo/10.json")!;
    expect(e.curve.monthly).toEqual([
      ["2026-04", 100, 80],
      ["2026-05", 50, 120],
      ["2026-06", 30, 150],
    ]);
  });

  test("curve.recent_daily = [[date, delta]] from model.recentDaily", () => {
    const e = views.get("entity/repo/10.json")!;
    expect(e.curve.recent_daily).toEqual([["2026-06-01", 10], ["2026-06-02", 20]]);
  });

  test("monthly_table mirrors months with adds+rank and is capped at the last 24", () => {
    const e = views.get("entity/repo/10.json")!;
    expect(e.monthly_table).toEqual([
      { month: "2026-04", adds: 100, rank: 1 },
      { month: "2026-05", adds: 50, rank: 1 },
      { month: "2026-06", adds: 30, rank: 1 },
    ]);
    expect(e.monthly_table.length).toBeLessThanOrEqual(24);
    // repo 30 ranks below repo 10 in shared months (flow desc tiebreak)
    expect(views.get("entity/repo/30.json")!.monthly_table[0].rank).toBe(2);
  });

  test("rank_history.month = [[period, flow_rank]]", () => {
    const e = views.get("entity/repo/10.json")!;
    expect(e.rank_history.month).toEqual([["2026-04", 1], ["2026-05", 1], ["2026-06", 1]]);
  });

  test("anchorDrift is ~0 when the curve endpoint matches current_stars", () => {
    // repo 10 ends at 150 (=current_stars), repo 30 ends at 60 (=current_stars) → zero drift
    expect(anchorDrift).toBe(0);
  });
});

describe("orgEntities", () => {
  const model = syntheticModel();
  const monthWin = computeRepoWindow(model, "month");
  const orgWin = computeOrgWindow(model, monthWin);
  const { views } = orgEntities(model, orgWin);

  test("emits one entity/org/<login>.json per org with aggregate identity", () => {
    expect([...views.keys()]).toEqual(["entity/org/alpha.json"]);
    const o = views.get("entity/org/alpha.json")!;
    expect(o.login).toBe("alpha");
    expect(o.owner_type).toBe("Organization");
    expect(o.current_stars_sum).toBe(210); // 150 + 60
    expect(o.repo_count).toBe(2);
    expect([...o.members].sort((a, b) => a - b)).toEqual([10, 30]);
  });

  test("org curve.recent_daily sums member deltas per day, date-asc", () => {
    const o = views.get("entity/org/alpha.json")!;
    // 2026-06-01: repo10 10 + repo30 5 = 15; 2026-06-02: repo10 20 = 20
    expect(o.curve.recent_daily).toEqual([["2026-06-01", 15], ["2026-06-02", 20]]);
  });

  test("org curve.monthly endpoint stock sums to current_stars_sum", () => {
    const o = views.get("entity/org/alpha.json")!;
    const lastStock = o.curve.monthly.at(-1)![2];
    expect(lastStock).toBe(210); // forward-filled member stocks sum to current_stars_sum
  });
});

describe("lookups", () => {
  const model = syntheticModel();
  const lk = lookups(model);

  test("returns lookup/repos.json and lookup/orgs.json maps", () => {
    expect([...lk.keys()].sort()).toEqual(["lookup/orgs.json", "lookup/repos.json"]);
  });

  test("repo lookup entry carries the slim identity fields", () => {
    const repoLk = lk.get("lookup/repos.json") as Record<string, Record<string, unknown>>;
    expect(repoLk["10"]).toEqual({
      owner: "alpha",
      name: "one",
      full_name: "alpha/one",
      owner_type: "Organization",
      language: "TypeScript",
      current_stars: 150,
    });
    expect(repoLk["30"].language).toBeNull(); // missing language → null
  });

  test("org lookup entry carries login + aggregate counts", () => {
    const orgLk = lk.get("lookup/orgs.json") as Record<string, Record<string, unknown>>;
    expect(orgLk["alpha"]).toEqual({
      login: "alpha",
      owner_type: "Organization",
      repo_count: 2,
      current_stars_sum: 210,
    });
  });
});

describe("searchIndex", () => {
  const model = syntheticModel();
  const generatedAt = "2024-06-01T00:00:00.000Z";
  const idx = searchIndex(model, generatedAt);
  const payload = idx.get("search/index.json") as { generated_at: string; count: number; repos: Array<Record<string, unknown>> };

  test("emits a single search/index.json view", () => {
    expect([...idx.keys()]).toEqual(["search/index.json"]);
  });

  test("count matches repos length; generated_at is passed through", () => {
    expect(payload.count).toBe(2);
    expect(payload.repos.length).toBe(2);
    expect(payload.generated_at).toBe(generatedAt);
  });

  test("docs are id-ascending and carry the lean searchable fields", () => {
    expect(payload.repos[0]).toEqual({
      id: 10,
      full_name: "alpha/one",
      owner: "alpha",
      language: "TypeScript",
      current_stars: 150,
      description: "first",
    });
  });

  test("missing language/description collapse to null", () => {
    expect(payload.repos[1]).toEqual({
      id: 30,
      full_name: "alpha/two",
      owner: "alpha",
      language: null,
      current_stars: 60,
      description: null,
    });
  });

  test("description is head-capped to bound the client payload", () => {
    const long = "x".repeat(500);
    const m = buildModel(
      {
        repos: { "1": { id: 1, owner: "o", owner_type: "User", name: "r", full_name: "o/r", description: long, current_stars: 5, d: 1 } },
        monthly: { "1": [] },
        weekly: { "1": [] },
        recentDaily: {},
        siteDailyByYear: {},
      } as unknown as RawShards,
      "2026-05-30",
    );
    const doc = (searchIndex(m, generatedAt).get("search/index.json") as { repos: Array<{ description: string }> }).repos[0];
    expect(doc.description.length).toBe(200);
  });
});

describe("repoEntities — inflections (v0.2 §3)", () => {
  test("tiny-flow repos get no inflections field (below ABS_FLOOR)", () => {
    const model = syntheticModel();
    const { views } = repoEntities(model, computeRepoWindow(model, "month"));
    expect(views.get("entity/repo/10.json")!.inflections).toBeUndefined();
  });

  test("a breakout month surfaces as a peak inflection on the entity", () => {
    const raw = {
      repos: { "5": { id: 5, owner: "x", owner_type: "User", name: "r", full_name: "x/r", current_stars: 3300, d: 1 } },
      monthly: { "5": [["2020-01", 100], ["2020-02", 100], ["2020-03", 100], ["2020-04", 3000]] },
      weekly: { "5": [] },
      recentDaily: {},
      siteDailyByYear: {},
    } as unknown as RawShards;
    const model = buildModel(raw, "2026-05-30");
    const { views } = repoEntities(model, computeRepoWindow(model, "month"));
    expect(views.get("entity/repo/5.json")!.inflections).toEqual([{ period: "2020-04", flow: 3000, kind: "peak" }]);
  });
});
