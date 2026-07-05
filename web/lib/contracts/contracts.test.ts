import { test, expect, describe } from "bun:test";
import {
  // common
  Meta,
  RankItem,
  RankList,
  OwnerType,
  Window,
  Metric,
  // canonical
  CanonicalMeta,
  ReposShardEntry,
  ReposShard,
  RepoMonthlyShard,
  RepoWeeklyShard,
  RepoRecentDailyShard,
  SiteDaily,
  WhitelistEntry,
  WhitelistSnapshot,
  PendingPeriod,
  // workflow
  ViewsPointer,
  WorkflowManifest,
  WorkflowStepCheckpoint,
  LatestSuccess,
  WorkflowValidation,
  RenameMap,
  // lookup
  RepoLookupEntry,
  ReposLookup,
  OrgLookupEntry,
  OrgsLookup,
  // entity
  RepoEntity,
  OrgEntity,
  Heatmap,
  Curve,
  Inflection,
  // live
  CurrentMonth,
  HotSnapshot,
  // search
  SearchDoc,
  SearchIndex,
  // compare
  CompareCurve,
  // categories
  CategoryDimension,
  CategoryRegistryEntry,
  CategoryRegistry,
  RepositoryCategoryAssignment,
  CategoryAssignments,
  CategoriesLookup,
  CategoryRankList,
} from "./index";

// Each block proves a schema PARSES a valid shape AND REJECTS a real bad one
// (wrong type / missing required field / bad enum). safeParse(bad).success must be false.

function rejects(schema: { safeParse: (v: unknown) => { success: boolean } }, bad: unknown): boolean {
  return schema.safeParse(bad).success === false;
}

const TS = "2024-06-01T00:00:00.000Z";

describe("common primitives", () => {
  test("OwnerType enum: valid parses, bad enum rejects", () => {
    expect(OwnerType.parse("User")).toBe("User");
    expect(OwnerType.parse("Organization")).toBe("Organization");
    expect(rejects(OwnerType, "Bot")).toBe(true);
  });

  test("Window enum rejects unknown member", () => {
    expect(Window.parse("month")).toBe("month");
    expect(rejects(Window, "decade")).toBe(true);
  });

  test("Metric enum rejects unknown member", () => {
    expect(Metric.parse("growth")).toBe("growth");
    expect(rejects(Metric, "velocity")).toBe(true);
  });
});

describe("Meta — accepts BOTH bootstrap flat meta AND Phase 4 versioned meta", () => {
  test("flat bootstrap meta (backfilled_at, no folded_through) parses", () => {
    const flat = {
      seam_date: "2024-01-01",
      schema_ver: 2,
      generated_at: TS,
      backfilled_at: TS,
    };
    expect(Meta.parse(flat)).toEqual(flat);
    expect(Meta.parse(flat).folded_through).toBeUndefined();
  });

  test("Phase 4 versioned meta (folded_through, no backfilled_at) parses", () => {
    const versioned = {
      seam_date: "2024-01-01",
      schema_ver: 3,
      folded_through: { month: "2024-05", week: "2024-W20" },
    };
    expect(Meta.parse(versioned)).toEqual(versioned);
    expect(Meta.parse(versioned).backfilled_at).toBeUndefined();
  });

  test("minimal meta (only required) parses", () => {
    expect(Meta.parse({ seam_date: "2024-01-01", schema_ver: 1 }).schema_ver).toBe(1);
  });

  test("rejects missing seam_date", () => {
    expect(rejects(Meta, { schema_ver: 1 })).toBe(true);
  });

  test("rejects non-int schema_ver", () => {
    expect(rejects(Meta, { seam_date: "2024-01-01", schema_ver: 1.5 })).toBe(true);
  });

  test("rejects partial folded_through (missing week)", () => {
    expect(
      rejects(Meta, { seam_date: "2024-01-01", schema_ver: 1, folded_through: { month: "2024-05" } }),
    ).toBe(true);
  });
});

describe("RankItem / RankList", () => {
  test("repo-dim RankItem (id) parses", () => {
    const item = { rank: 1, id: 123, value: 500, prev_rank: 2 };
    expect(RankItem.parse(item)).toEqual(item);
  });

  test("org-dim RankItem with derived fields parses, prev_rank nullable", () => {
    const item = { rank: 1, login: "vercel", value: -10, prev_rank: null, rate: 12.5, base: 100, date: "2024-03-01" };
    expect(RankItem.parse(item).prev_rank).toBeNull();
  });

  test("rejects missing prev_rank (required, nullable but present)", () => {
    expect(rejects(RankItem, { rank: 1, id: 1, value: 5 })).toBe(true);
  });

  test("rejects non-int value", () => {
    expect(rejects(RankItem, { rank: 1, id: 1, value: 5.5, prev_rank: null })).toBe(true);
  });

  test("rejects both repo id and org login on one RankItem", () => {
    expect(rejects(RankItem, { rank: 1, id: 1, login: "vercel", value: 5, prev_rank: null })).toBe(true);
  });

  test("RankList parses with nested meta + items array", () => {
    const list = {
      meta: { window: "month", period: "2024-05", dim: "repo", metric: "flow", generated_at: TS },
      items: [{ rank: 1, id: 1, value: 10, prev_rank: null }],
    };
    expect(RankList.parse(list).items).toHaveLength(1);
  });

  test("RankList rejects bad dim enum in meta", () => {
    expect(
      rejects(RankList, {
        meta: { window: "month", period: "2024-05", dim: "user", metric: "flow", generated_at: "x" },
        items: [],
      }),
    ).toBe(true);
  });
});

describe("CanonicalMeta", () => {
  test("parses seam_date + schema_ver + folded_through{month,week}", () => {
    const meta = { seam_date: "2024-01-01", schema_ver: 2, folded_through: { month: "2024-05", week: "2024-W20" } };
    expect(CanonicalMeta.parse(meta)).toEqual(meta);
  });

  test("rejects missing folded_through (required here, unlike Meta)", () => {
    expect(rejects(CanonicalMeta, { seam_date: "2024-01-01", schema_ver: 2 })).toBe(true);
  });

  test("rejects folded_through missing week", () => {
    expect(
      rejects(CanonicalMeta, { seam_date: "2024-01-01", schema_ver: 2, folded_through: { month: "2024-05" } }),
    ).toBe(true);
  });
});

describe("canonical shards", () => {
  const validEntry = {
    id: 1,
    node_id: "MDEwOlJlcG9z",
    owner: "vercel",
    owner_type: "Organization",
    name: "next.js",
    full_name: "vercel/next.js",
    current_stars: 120000,
  };

  test("ReposShardEntry parses minimal valid entry", () => {
    expect(ReposShardEntry.parse(validEntry).id).toBe(1);
  });

  test("ReposShardEntry parses with optional/nullable fields", () => {
    const full = {
      ...validEntry,
      description: null,
      language: "TypeScript",
      languages: [{ name: "TypeScript", size: 1200, color: "#3178c6" }],
      topics: ["react"],
      crossed_10k: "2020-01-01",
      d: 0.95,
    };
    expect(ReposShardEntry.parse(full).d).toBe(0.95);
  });

  test("ReposShardEntry rejects bad owner_type enum", () => {
    expect(rejects(ReposShardEntry, { ...validEntry, owner_type: "Bot" })).toBe(true);
  });

  test("ReposShardEntry rejects missing required full_name", () => {
    const { full_name, ...missing } = validEntry;
    expect(rejects(ReposShardEntry, missing)).toBe(true);
  });

  test("ReposShard parses record keyed by stringified id", () => {
    expect(Object.keys(ReposShard.parse({ "1": validEntry }))).toEqual(["1"]);
  });

  test("ReposShard rejects entry with wrong value shape", () => {
    expect(rejects(ReposShard, { "1": { id: "not-a-number" } })).toBe(true);
  });

  test("RepoMonthlyShard parses [period, flow] tuples", () => {
    const m = { "1": [["2024-05", 100] as [string, number], ["2024-06", -5] as [string, number]] };
    expect(RepoMonthlyShard.parse(m)["1"]).toHaveLength(2);
  });

  test("RepoMonthlyShard rejects non-int flow", () => {
    expect(rejects(RepoMonthlyShard, { "1": [["2024-05", 1.5]] })).toBe(true);
  });

  test("RepoWeeklyShard parses week tuples", () => {
    expect(RepoWeeklyShard.parse({ "1": [["2024-W20", 12]] })["1"][0][0]).toBe("2024-W20");
  });

  test("RepoWeeklyShard rejects 3-element tuple (wrong arity)", () => {
    expect(rejects(RepoWeeklyShard, { "1": [["2024-W20", 12, 99]] })).toBe(true);
  });

  test("RepoRecentDailyShard parses [date, net] tuples (net negative ok)", () => {
    expect(RepoRecentDailyShard.parse({ "1": [["2024-05-01", -3]] })["1"][0][1]).toBe(-3);
  });

  test("RepoRecentDailyShard rejects string delta", () => {
    expect(rejects(RepoRecentDailyShard, { "1": [["2024-05-01", "x"]] })).toBe(true);
  });

  test("SiteDaily parses year + cells", () => {
    const sd = { year: "2024", cells: [["2024-01-01", 500] as [string, number]] };
    expect(SiteDaily.parse(sd).cells).toHaveLength(1);
  });

  test("SiteDaily rejects missing cells", () => {
    expect(rejects(SiteDaily, { year: "2024" })).toBe(true);
  });

  test("WhitelistEntry parses; rejects missing stars", () => {
    const w = { id: 1, node_id: "n", full_name: "a/b", owner: "a", name: "b", stars: 12000 };
    expect(WhitelistEntry.parse(w).stars).toBe(12000);
    const { stars, ...bad } = w;
    expect(rejects(WhitelistEntry, bad)).toBe(true);
  });

  test("WhitelistSnapshot parses with diff added/dropped", () => {
    const snap = {
      run_id: "r1",
      generated_at: TS,
      count: 1,
      entries: [{ id: 1, node_id: "n", full_name: "a/b", owner: "a", name: "b", stars: 12000 }],
      diff: { added: [2], dropped: [3] },
    };
    expect(WhitelistSnapshot.parse(snap).diff.added).toEqual([2]);
  });

  test("WhitelistSnapshot rejects diff.added with non-int ids", () => {
    expect(
      rejects(WhitelistSnapshot, {
        run_id: "r1",
        generated_at: "x",
        count: 0,
        entries: [],
        diff: { added: ["two"], dropped: [] },
      }),
    ).toBe(true);
  });

  test("PendingPeriod parses period + daily_totals + per_repo", () => {
    const p = {
      period: "2024-05",
      frozen_at: TS,
      daily_totals: [["2024-05-31", 42] as [string, number]],
      per_repo: { "1": [["2024-05-31", 7] as [string, number]] },
    };
    expect(PendingPeriod.parse(p).per_repo["1"]).toHaveLength(1);
  });

  test("PendingPeriod rejects missing frozen_at", () => {
    expect(rejects(PendingPeriod, { period: "2024-05", daily_totals: [], per_repo: {} })).toBe(true);
  });
});

describe("workflow contracts", () => {
  test("ViewsPointer parses (prev_version nullable)", () => {
    const vp = { version: "v3", run_id: "r3", published_at: TS, prev_version: null, schema_ver: 2 };
    expect(ViewsPointer.parse(vp).prev_version).toBeNull();
    expect(ViewsPointer.parse({ ...vp, prev_version: "v2" }).prev_version).toBe("v2");
  });

  test("ViewsPointer rejects missing schema_ver", () => {
    expect(rejects(ViewsPointer, { version: "v3", run_id: "r3", published_at: "x", prev_version: null })).toBe(true);
  });

  test("WorkflowManifest parses with status enum + nullable published_version", () => {
    const m = { run_id: "r1", started_at: TS, status: "running", steps: ["a", "b"], published_version: null };
    expect(WorkflowManifest.parse(m).status).toBe("running");
    expect(WorkflowManifest.parse({ ...m, status: "published", published_version: "v1" }).status).toBe("published");
  });

  test("WorkflowManifest rejects bad status enum", () => {
    expect(
      rejects(WorkflowManifest, { run_id: "r1", started_at: "x", status: "pending", steps: [], published_version: null }),
    ).toBe(true);
  });

  test("WorkflowStepCheckpoint parses with StepStatus enum", () => {
    const s = { step: "build", status: "ok", started_at: TS, finished_at: null };
    expect(WorkflowStepCheckpoint.parse(s).status).toBe("ok");
  });

  test("WorkflowStepCheckpoint rejects bad step status enum", () => {
    expect(rejects(WorkflowStepCheckpoint, { step: "build", status: "done", started_at: "x", finished_at: null })).toBe(true);
  });

  test("LatestSuccess parses; rejects missing version", () => {
    expect(LatestSuccess.parse({ run_id: "r1", version: "v1", published_at: TS }).version).toBe("v1");
    expect(rejects(LatestSuccess, { run_id: "r1", published_at: "x" })).toBe(true);
  });

  test("WorkflowValidation parses with invariants union(bool|number)", () => {
    const v = {
      run_id: "r1",
      ok: true,
      checked: 100,
      schema_failures: 0,
      invariants: { monotonic: true, max_rank: 500 },
      failures: [],
    };
    expect(WorkflowValidation.parse(v).invariants.max_rank).toBe(500);
  });

  test("WorkflowValidation rejects non-boolean ok", () => {
    expect(
      rejects(WorkflowValidation, { run_id: "r1", ok: "yes", checked: 1, schema_failures: 0, invariants: {}, failures: [] }),
    ).toBe(true);
  });

  test("RenameMap parses renames array", () => {
    const rm = { run_id: "r1", generated_at: TS, renames: [{ id: 1, old_full_name: "a/b", new_full_name: "a/c" }] };
    expect(RenameMap.parse(rm).renames[0].new_full_name).toBe("a/c");
  });

  test("RenameMap rejects rename entry missing new_full_name", () => {
    expect(rejects(RenameMap, { run_id: "r1", generated_at: "x", renames: [{ id: 1, old_full_name: "a/b" }] })).toBe(true);
  });
});

describe("lookup contracts", () => {
  const repoEntry = { owner: "vercel", name: "next.js", full_name: "vercel/next.js", owner_type: "Organization", language: "TypeScript", current_stars: 120000 };

  test("RepoLookupEntry parses (language nullable)", () => {
    expect(RepoLookupEntry.parse({ ...repoEntry, language: null }).language).toBeNull();
  });

  test("RepoLookupEntry rejects bad owner_type", () => {
    expect(rejects(RepoLookupEntry, { ...repoEntry, owner_type: "Robot" })).toBe(true);
  });

  test("ReposLookup parses record; rejects bad nested entry", () => {
    expect(Object.keys(ReposLookup.parse({ "1": repoEntry }))).toEqual(["1"]);
    expect(rejects(ReposLookup, { "1": { owner: "x" } })).toBe(true);
  });

  test("OrgLookupEntry parses; rejects non-int repo_count", () => {
    const o = { login: "vercel", owner_type: "Organization", repo_count: 50, current_stars_sum: 500000 };
    expect(OrgLookupEntry.parse(o).repo_count).toBe(50);
    expect(rejects(OrgLookupEntry, { ...o, repo_count: 1.5 })).toBe(true);
  });

  test("OrgsLookup parses record keyed by login", () => {
    expect(
      OrgsLookup.parse({ vercel: { login: "vercel", owner_type: "User", repo_count: 1, current_stars_sum: 1 } }).vercel.login,
    ).toBe("vercel");
  });
});

describe("entity / view contracts", () => {
  const curve = { monthly: [["2024-05", 100, 1200] as [string, number, number]], recent_daily: [["2024-05-31", -3] as [string, number]] };

  test("Curve parses monthly + recent_daily tuples", () => {
    expect(Curve.parse(curve).monthly[0]).toHaveLength(3);
  });

  test("Curve rejects monthly tuple with wrong arity", () => {
    expect(rejects(Curve, { monthly: [["2024-05", 100]], recent_daily: [] })).toBe(true);
  });

  const repoEntity = {
    id: 1,
    full_name: "vercel/next.js",
    owner: "vercel",
    owner_type: "Organization",
    name: "next.js",
    description: null,
    language: "TypeScript",
    languages: [{ name: "TypeScript", size: 5000, color: "#3178c6" }],
    topics: ["react"],
    created_at: "2016-10-05",
    current_stars: 120000,
    is_archived: false,
    milestones: { crossed_10k: "2018-01-01", crossed_50k: null, crossed_100k: null },
    curve,
    monthly_table: [{ month: "2024-05", adds: 100, rank: 1 }],
  };

  test("RepoEntity parses full object (rank_history optional)", () => {
    const parsed = RepoEntity.parse(repoEntity);
    expect(parsed.id).toBe(1);
    expect(parsed.languages?.[0].name).toBe("TypeScript");
  });

  test("RepoEntity parses with optional rank_history record", () => {
    expect(RepoEntity.parse({ ...repoEntity, rank_history: { month: [["2024-05", 1]] } }).id).toBe(1);
  });

  test("RepoEntity accepts http and https external URLs plus empty sentinels", () => {
    expect(
      RepoEntity.parse({
        ...repoEntity,
        homepage_url: "http://example.com",
        latest_release: { tag_name: "v1.0.0", url: "https://github.com/vercel/next.js/releases/tag/v1.0.0" },
      }).latest_release?.url,
    ).toBe("https://github.com/vercel/next.js/releases/tag/v1.0.0");
    expect(RepoEntity.parse({ ...repoEntity, homepage_url: "", latest_release: { tag_name: "v1.0.0", url: "" } }).homepage_url).toBe("");
  });

  test("RepoEntity rejects non-http(s) homepage and release URLs", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<h1>x</h1>", "file:///etc/passwd", "ftp://example.com/file", "mailto:security@example.com"]) {
      expect(rejects(RepoEntity, { ...repoEntity, homepage_url: value })).toBe(true);
      expect(rejects(RepoEntity, { ...repoEntity, latest_release: { tag_name: "v1.0.0", url: value } })).toBe(true);
    }
  });

  test("RepoEntity rejects missing required milestones", () => {
    const { milestones, ...bad } = repoEntity;
    expect(rejects(RepoEntity, bad)).toBe(true);
  });

  test("RepoEntity rejects non-array topics", () => {
    expect(rejects(RepoEntity, { ...repoEntity, topics: "react" })).toBe(true);
  });

  test("Inflection parses; rejects bad kind enum", () => {
    expect(Inflection.parse({ period: "2021-03", flow: 12000, kind: "peak" }).kind).toBe("peak");
    expect(rejects(Inflection, { period: "2021-03", flow: 12000, kind: "spike" })).toBe(true);
  });

  test("RepoEntity parses with optional inflections", () => {
    const e = RepoEntity.parse({ ...repoEntity, inflections: [{ period: "2021-03", flow: 12000, kind: "surge" }] });
    expect(e.inflections).toHaveLength(1);
  });

  const orgEntity = { login: "vercel", owner_type: "Organization", current_stars_sum: 500000, repo_count: 50, members: [1, 2, 3], curve };

  test("OrgEntity parses; rejects non-int members", () => {
    expect(OrgEntity.parse(orgEntity).members).toEqual([1, 2, 3]);
    expect(rejects(OrgEntity, { ...orgEntity, members: ["1"] })).toBe(true);
  });

  test("Heatmap parses scope enum + cells", () => {
    const h = { meta: { scope: "year", period: "2024", generated_at: TS }, cells: [["2024-01-01", 10] as [string, number]] };
    expect(Heatmap.parse(h).meta.scope).toBe("year");
  });

  test("Heatmap rejects bad scope enum", () => {
    expect(rejects(Heatmap, { meta: { scope: "week", period: "2024", generated_at: "x" }, cells: [] })).toBe(true);
  });
});

describe("live contracts", () => {
  test("CurrentMonth parses daily_totals + per_repo + current_stars", () => {
    const cm = {
      month: "2024-05",
      updated: "2024-05-31",
      daily_totals: [["2024-05-31", 42] as [string, number]],
      per_repo: { "1": [["2024-05-31", 7] as [string, number]] },
      current_stars: { "1": 120000 },
    };
    expect(CurrentMonth.parse(cm).current_stars["1"]).toBe(120000);
  });

  test("CurrentMonth rejects missing current_stars", () => {
    expect(rejects(CurrentMonth, { month: "2024-05", updated: "2024-05-31", daily_totals: [], per_repo: {} })).toBe(true);
  });

  test("HotSnapshot parses nested home/current/all_time", () => {
    const rankItems = [{ rank: 1, id: 1, value: 10, prev_rank: null }];
    const orgRankItems = [{ rank: 1, login: "vercel", value: 10, prev_rank: null }];
    const topLists = { flow: rankItems, stock: rankItems };
    const hs = {
      generated_at: TS,
      home: {
        year_spine: [["2024", 1000] as [string, number]],
        current_month_top: topLists,
        on_this_day: [{ id: 1, crossed: "10k", date: "2024-06-01" }],
      },
      current_year: topLists,
      current_month: topLists,
      all_time: { repo: rankItems, org: orgRankItems },
    };
    expect(HotSnapshot.parse(hs).home.on_this_day[0].id).toBe(1);
  });

  test("HotSnapshot rejects missing all_time", () => {
    const topLists = { flow: [], stock: [] };
    expect(
      rejects(HotSnapshot, {
        generated_at: "x",
        home: { year_spine: [], current_month_top: topLists, on_this_day: [] },
        current_year: topLists,
        current_month: topLists,
      }),
    ).toBe(true);
  });
});

describe("search contracts", () => {
  const doc = { id: 1, full_name: "vercel/next.js", owner: "vercel", language: "TypeScript", current_stars: 120000, description: "The React Framework" };

  test("SearchDoc parses; language/description nullable", () => {
    expect(SearchDoc.parse({ ...doc, language: null, description: null }).id).toBe(1);
  });

  test("SearchDoc rejects non-int current_stars", () => {
    expect(rejects(SearchDoc, { ...doc, current_stars: 1.5 })).toBe(true);
  });

  test("SearchDoc rejects missing full_name", () => {
    const { full_name, ...bad } = doc;
    expect(rejects(SearchDoc, bad)).toBe(true);
  });

  test("SearchIndex parses generated_at + count + repos[]", () => {
    const idx = { generated_at: TS, count: 1, repos: [doc] };
    expect(SearchIndex.parse(idx).repos).toHaveLength(1);
  });

  test("SearchIndex rejects non-array repos", () => {
    expect(rejects(SearchIndex, { generated_at: "x", count: 0, repos: {} })).toBe(true);
  });
});

describe("category contracts", () => {
  const category = {
    id: "language/python",
    dimension: "language",
    slug: "python",
    label: "Python",
    aliases: ["py"],
    count: 120,
    public: true,
    sitemap: true,
    minimum_repo_count: 20,
  };

  test("CategoryDimension rejects unknown dimension", () => {
    expect(CategoryDimension.parse("language")).toBe("language");
    expect(rejects(CategoryDimension, "license")).toBe(true);
  });

  test("CategoryRegistryEntry parses stable ids and rejects bad id format", () => {
    expect(CategoryRegistryEntry.parse(category).id).toBe("language/python");
    expect(rejects(CategoryRegistryEntry, { ...category, id: "language:python" })).toBe(true);
  });

  test("CategoryRegistry parses dimensions with categories", () => {
    const registry = {
      rules_version: "2026-06-05.1",
      generated_at: TS,
      dimensions: [{ id: "language", label: "Language", categories: [category] }],
    };
    expect(CategoryRegistry.parse(registry).dimensions[0].categories).toHaveLength(1);
  });

  const assignment = {
    language: ["language/python"],
    language_family: ["language_family/python"],
    domain: ["domain/ai-ml"],
    project_type: ["project_type/library"],
    ecosystem: ["ecosystem/python"],
    owner_kind: ["owner_kind/organization"],
    maturity: ["maturity/star-10k", "maturity/active"],
  };

  test("RepositoryCategoryAssignment parses every dimension", () => {
    expect(RepositoryCategoryAssignment.parse(assignment).language[0]).toBe("language/python");
  });

  test("RepositoryCategoryAssignment rejects invalid category id", () => {
    expect(rejects(RepositoryCategoryAssignment, { ...assignment, domain: ["domain:ai-ml"] })).toBe(true);
  });

  test("RepositoryCategoryAssignment rejects multiple owner_kind values", () => {
    expect(rejects(RepositoryCategoryAssignment, { ...assignment, owner_kind: ["owner_kind/organization", "owner_kind/user"] })).toBe(true);
  });

  test("CategoryAssignments parses record keyed by repo id", () => {
    const payload = { rules_version: "2026-06-05.1", generated_at: TS, repositories: { "1": assignment } };
    expect(CategoryAssignments.parse(payload).repositories["1"].ecosystem).toEqual(["ecosystem/python"]);
  });

  test("CategoriesLookup parses public category metadata", () => {
    const lookup = {
      rules_version: "2026-06-05.1",
      generated_at: TS,
      dimensions: [{ id: "language", label: "Language", categories: [{ id: "language/python", slug: "python", label: "Python", count: 120, sitemap: true }] }],
    };
    const parsed = CategoriesLookup.parse(lookup);
    expect(parsed.dimensions[0].categories[0].slug).toBe("python");
    expect(parsed.dimensions[0].categories[0].sitemap).toBe(true);
    expect(
      CategoriesLookup.parse({
        ...lookup,
        dimensions: [{ id: "language", label: "Language", categories: [{ id: "language/rust", slug: "rust", label: "Rust", count: 40 }] }],
      }).dimensions[0].categories[0].sitemap,
    ).toBeUndefined();
  });

  test("CategoryRankList parses category meta + repo items", () => {
    const rank = {
      meta: {
        window: "all",
        period: "all",
        dim: "repo",
        metric: "stock",
        generated_at: TS,
        category: { id: "language/python", dimension: "language", slug: "python" },
      },
      items: [{ rank: 1, id: 1, value: 120000, prev_rank: null }],
    };
    expect(CategoryRankList.parse(rank).meta.category.id).toBe("language/python");
  });

  test("CategoryRankList rejects org dim", () => {
    expect(
      rejects(CategoryRankList, {
        meta: {
          window: "all",
          period: "all",
          dim: "org",
          metric: "stock",
          generated_at: "x",
          category: { id: "language/python", dimension: "language", slug: "python" },
        },
        items: [],
      }),
    ).toBe(true);
  });

  test("CategoryRankList rejects derived global metrics", () => {
    expect(
      rejects(CategoryRankList, {
        meta: {
          window: "month",
          period: "2026-05",
          dim: "repo",
          metric: "growth",
          generated_at: "x",
          category: { id: "language/python", dimension: "language", slug: "python" },
        },
        items: [],
      }),
    ).toBe(true);
  });
});

describe("compare contracts", () => {
  const curve = {
    id: 10270250,
    full_name: "facebook/react",
    current_stars: 232000,
    crossed_10k: "2014-09-15",
    points: [["2014-01", 9800] as [string, number], ["2014-02", 10400] as [string, number]],
  };

  test("CompareCurve parses; crossed_10k nullable", () => {
    expect(CompareCurve.parse({ ...curve, crossed_10k: null }).points).toHaveLength(2);
  });

  test("CompareCurve rejects point tuple with wrong arity", () => {
    expect(rejects(CompareCurve, { ...curve, points: [["2014-01", 9800, 1]] })).toBe(true);
  });

  test("CompareCurve rejects non-int current_stars", () => {
    expect(rejects(CompareCurve, { ...curve, current_stars: 1.5 })).toBe(true);
  });
});
