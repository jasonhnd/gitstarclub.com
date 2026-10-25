import { describe, expect, spyOn, test } from "bun:test";
import * as source from "@/lib/data/source";
import * as write from "@/lib/data/write";
import * as canonical from "@/lib/workflows/canonical-validation";
import { HISTORY_AVAILABILITY_KEY } from "@/lib/workflows/history-availability";
import { REPO_BUCKETS } from "../buckets";
import { HIGH_D_FACTOR_WARN_THRESHOLD, inspectAnchoringFactors, validateVersion } from "./validate";
import { validateAliases, validateAllTimeRanks, validateCategories, validateMeta, validateRepositoryMembership, validateSearchIndex } from "./validate-invariants";

describe("inspectAnchoringFactors", () => {
  test("reports high anchoring factors without producing publish failures", () => {
    expect(
      inspectAnchoringFactors([
        {
          "1": { d: 0.8 },
          "2": { d: HIGH_D_FACTOR_WARN_THRESHOLD },
          "3": { d: HIGH_D_FACTOR_WARN_THRESHOLD + 0.01 },
          "4": { d: 12.9123 },
          "5": {},
        },
      ]),
    ).toEqual({
      d_factor_warn_threshold: HIGH_D_FACTOR_WARN_THRESHOLD,
      d_factor_repos_checked: 5,
      d_factor_repos_with_d: 4,
      d_factor_historical_missing: 1,
      d_factor_newcomer_default_zero: 0,
      d_factor_high_count: 2,
      d_factor_max: 12.912,
      d_factor_warning: true,
    });
  });
});

describe("validateRepositoryMembership", () => {
  const whitelist = {
    run_id: "refresh-test",
    generated_at: "2026-07-17T00:00:00.000Z",
    count: 2,
    entries: [
      { id: 1, node_id: "R_1", full_name: "owner/one", owner: "owner", name: "one", stars: 100 },
      { id: 3, node_id: "R_3", full_name: "owner/three", owner: "owner", name: "three", stars: 100 },
    ],
    diff: { added: [3], dropped: [2] },
  };

  test("only an audited missing newcomer may be absent from canonical, lookup, and counts", () => {
    const input = {
      previousLookup: { "1": repoLookup("owner/one", 100), "2": repoLookup("owner/two", 80) },
      lookup: { "1": repoLookup("owner/one", 100), "2": { ...repoLookup("owner/two", 80), active: false } },
      whitelist,
      canonicalRepoIds: new Set(["1", "2"]), canonicalActiveRepoIds: new Set(["1"]),
      meta: { seam_date: "2026-01-01", schema_ver: 1, active_repo_count: 1, historical_repo_count: 1 },
    };
    expect(validateRepositoryMembership(input).failures.length).toBeGreaterThan(0);
    const missing = { id: 3, node_id: "R_3", full_name: "owner/three", reason: "graphql_502", value_status: "missing" } as const;
    const accepted = validateRepositoryMembership({ ...input, metadataSkipped: [missing] });
    expect(accepted.failures).toEqual([]);
    expect(accepted.invariants).toMatchObject({ metadata_skipped_repos: 1, metadata_missing_repos: 1 });
    expect(validateRepositoryMembership({ ...input, metadataSkipped: [{ ...missing, node_id: "wrong" }] }).failures.length).toBeGreaterThan(0);
    expect(validateRepositoryMembership({ ...input, metadataSkipped: [{ ...missing, id: 1, node_id: "R_1", full_name: "owner/one" }] }).failures).toContain("metadata skip 1: missing status would discard existing values");
    expect(validateRepositoryMembership({ ...input, metadataSkipped: [{ ...missing, value_status: "retained" }] }).failures).toContain("metadata skip 3: previous values were not retained");
  });

  test("a retained skip cannot replace a published star count with zero", () => {
    const report = validateRepositoryMembership({
      previousLookup: { "1": repoLookup("owner/one", 100), "2": repoLookup("owner/two", 80) },
      lookup: { "1": repoLookup("owner/one", 0), "2": { ...repoLookup("owner/two", 80), active: false }, "3": repoLookup("owner/three", 100) },
      whitelist, canonicalRepoIds: new Set(["1", "2", "3"]), canonicalActiveRepoIds: new Set(["1", "3"]), meta: null,
      metadataSkipped: [{ id: 1, node_id: "R_1", full_name: "owner/one", reason: "graphql_502", value_status: "retained" }],
    });
    expect(report.failures).toContain("metadata skip 1: previous values were not retained");
  });

  test("a previously missing whitelist member may resolve even when it is no longer in diff.added", () => {
    const report = validateRepositoryMembership({
      previousLookup: { "1": repoLookup("owner/one", 100), "2": { ...repoLookup("owner/two", 80), active: false } },
      lookup: { "1": repoLookup("owner/one", 100), "2": { ...repoLookup("owner/two", 80), active: false }, "3": repoLookup("owner/three", 100) },
      whitelist: { ...whitelist, diff: { added: [], dropped: [] } },
      canonicalRepoIds: new Set(["1", "2", "3"]), canonicalActiveRepoIds: new Set(["1", "3"]), meta: null,
      previousMetadataSkipped: [{ id: 3, node_id: "R_3", full_name: "owner/three", reason: "graphql_502", value_status: "missing" }],
    });
    expect(report.failures).toEqual([]);
  });

  test("dropping a previously audited missing newcomer needs no invented historical row", () => {
    const report = validateRepositoryMembership({
      previousLookup: { "1": repoLookup("owner/one", 100) },
      lookup: { "1": repoLookup("owner/one", 100) },
      whitelist: { ...whitelist, count: 1, entries: [whitelist.entries[0]], diff: { added: [], dropped: [3] } },
      canonicalRepoIds: new Set(["1"]), canonicalActiveRepoIds: new Set(["1"]), meta: null,
      previousMetadataSkipped: [{ id: 3, node_id: "R_3", full_name: "owner/three", reason: "graphql_502", value_status: "missing" }],
    });
    expect(report.failures).toEqual([]);
  });

  test("accepts approved additions while retaining dropped history", () => {
    const report = validateRepositoryMembership({
      previousLookup: { "1": repoLookup("owner/one", 100), "2": repoLookup("owner/two", 80) },
      lookup: {
        "1": repoLookup("owner/one", 100),
        "2": { ...repoLookup("owner/two", 80), active: false },
        "3": repoLookup("owner/three", 100),
      },
      whitelist,
      canonicalRepoIds: new Set(["1", "2", "3"]),
      canonicalActiveRepoIds: new Set(["1", "3"]),
      meta: { seam_date: "2026-01-01", schema_ver: 1, active_repo_count: 2, historical_repo_count: 1 },
    });
    expect(report.failures).toEqual([]);
    expect(report.invariants).toMatchObject({
      membership_previous_repos: 2,
      membership_expected_repos: 3,
      membership_missing_expected: 0,
      membership_unapproved_additions: 0,
    });
  });

  test("fails mass loss and unapproved membership changes with exact counts", () => {
    const report = validateRepositoryMembership({
      previousLookup: { "1": repoLookup("owner/one", 100), "2": repoLookup("owner/two", 80) },
      lookup: { "1": repoLookup("owner/one", 100), "4": repoLookup("owner/four", 10) },
      whitelist,
      canonicalRepoIds: new Set(["1", "2", "3"]),
      canonicalActiveRepoIds: new Set(["1", "3"]),
      meta: { seam_date: "2026-01-01", schema_ver: 1, active_repo_count: 2, historical_repo_count: 0 },
    });
    expect(report.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing 2 canonical id(s)"),
        expect.stringContaining("contains 1 id(s) absent from canonical"),
        expect.stringContaining("missing 1 active whitelist id(s)"),
        expect.stringContaining("lost 2 previously tracked/approved id(s)"),
        expect.stringContaining("contains 1 unapproved new id(s)"),
      ]),
    );
  });

  test("accepts re-entry when the added repository already exists as inactive history", () => {
    const reentryWhitelist = {
      ...whitelist,
      count: 2,
      entries: [whitelist.entries[0], { ...whitelist.entries[1], id: 2, node_id: "R_2", full_name: "owner/two", name: "two" }],
      diff: { added: [2], dropped: [] },
    };
    const report = validateRepositoryMembership({
      previousLookup: {
        "1": repoLookup("owner/one", 100),
        "2": { ...repoLookup("owner/two", 80), active: false, tracked_since: "2026-06-01" },
      },
      lookup: {
        "1": repoLookup("owner/one", 100),
        "2": { ...repoLookup("owner/two", 90), active: true, tracked_since: "2026-06-01" },
      },
      whitelist: reentryWhitelist,
      canonicalRepoIds: new Set(["1", "2"]),
      canonicalActiveRepoIds: new Set(["1", "2"]),
      meta: { seam_date: "2026-01-01", schema_ver: 1, active_repo_count: 2, historical_repo_count: 0 },
    });
    expect(report.failures).toEqual([]);
  });
});

describe("validateAllTimeRanks", () => {
  const generatedAt = "2026-08-02T00:00:00.000Z";

  test("fails when all-time rank values diverge from lookup current_stars", () => {
    const report = validateAllTimeRanks({
      allTime: {
        meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: generatedAt },
        items: [{ rank: 1, id: 1, value: 452060, prev_rank: null }],
      },
      allTimeOrg: {
        meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: generatedAt },
        items: [{ rank: 1, login: "freeCodeCamp", value: 452060, prev_rank: null }],
      },
      lookup: { "1": repoLookup("freeCodeCamp/freeCodeCamp", 453333) },
      orgLookup: { freeCodeCamp: { login: "freeCodeCamp", owner_type: "Organization", repo_count: 1, current_stars_sum: 453333 } },
      minLookup: 1,
    });
    expect(report.failures).toEqual([
      "all-time/repo: 1 item(s) differ from lookup current_stars",
      "all-time/org: 1 item(s) differ from lookup current_stars_sum",
    ]);
    expect(report.invariants).toMatchObject({
      all_time_repo_current_stars_mismatch: 1,
      all_time_org_current_stars_mismatch: 1,
    });
  });

  test("accepts all-time ranks written from the same snapshot as lookup", () => {
    const report = validateAllTimeRanks({
      allTime: {
        meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: generatedAt },
        items: [{ rank: 1, id: 1, value: 453333, prev_rank: null }],
      },
      allTimeOrg: {
        meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: generatedAt },
        items: [{ rank: 1, login: "freeCodeCamp", value: 453333, prev_rank: null }],
      },
      lookup: { "1": repoLookup("freeCodeCamp/freeCodeCamp", 453333) },
      orgLookup: { freeCodeCamp: { login: "freeCodeCamp", owner_type: "Organization", repo_count: 1, current_stars_sum: 453333 } },
      minLookup: 1,
    });
    expect(report.failures).toEqual([]);
    expect(report.invariants).toMatchObject({
      all_time_repo_current_stars_mismatch: 0,
      all_time_org_current_stars_mismatch: 0,
    });
  });
});

describe("validateMeta", () => {
  test("reports folded_through regressions with the published failure wording", () => {
    expect(
      validateMeta(
        {
          seam_date: "2026-01-01",
          schema_ver: 1,
          folded_through: { month: "2026-03", week: "2026-W10" },
        },
        {
          seam_date: "2026-01-01",
          schema_ver: 1,
          folded_through: { month: "2026-04", week: "2026-W11" },
        },
      ),
    ).toEqual({
      invariants: {
        seam_date_present: true,
        folded_through_monotonic: false,
      },
      failures: ["meta.folded_through regressed from 2026-04/2026-W11 to 2026-03/2026-W10"],
    });
  });
});

describe("validateAliases", () => {
  test("counts dangling, colliding, and regressed aliases", () => {
    expect(
      validateAliases(
        { "old/name": 9, "owner/live": 1 },
        {
          "1": repoLookup("owner/live", 100),
          "2": repoLookup("owner/other", 80),
        },
        { "old/name": 9, "owner/live": 1, "older/name": 2 },
      ),
    ).toEqual({
      invariants: {
        alias_count: 2,
        alias_dangling: 1,
        alias_colliding: 1,
        alias_prev_count: 3,
        alias_non_regression: false,
      },
      failures: [
        "lookup/aliases: 1 alias(es) point to an untracked id",
        "lookup/aliases: 1 alias(es) shadow a live repo",
        "lookup/aliases: count regressed from 3 to 2",
      ],
    });
  });
});

describe("validateSearchIndex", () => {
  test("keeps the existing minimum repo failure shape", () => {
    expect(
      validateSearchIndex(
        {
          generated_at: "2026-01-01T00:00:00.000Z",
          count: 1,
          repos: [{ id: 1, full_name: "owner/repo", owner: "owner", language: "TypeScript", current_stars: 10, description: null, active: true, tracked_since: null }],
        },
        2,
      ),
    ).toEqual({
      invariants: { search_repos: 1, search_missing_tracking_contract: 0 },
      failures: ["search/index: only 1 repos"],
    });
  });
});

describe("validateCategories", () => {
  test("reports registry, assignment, and lookup invariants independently", () => {
    const report = validateCategories({
      categoryRegistry: {
        rules_version: "test",
        generated_at: "2026-01-01T00:00:00.000Z",
        dimensions: [
          {
            id: "language",
            label: "Language",
            categories: [
              { id: "language/typescript", dimension: "language", slug: "typescript", label: "TypeScript", count: 1, public: true, sitemap: true, minimum_repo_count: 1 },
            ],
          },
        ],
      },
      categoryAssignments: {
        rules_version: "test",
        generated_at: "2026-01-01T00:00:00.000Z",
        repositories: {
          "1": {
            language: ["language/typescript"],
            language_family: [],
            domain: [],
            project_type: [],
            ecosystem: [],
            owner_kind: [],
            maturity: [],
          },
        },
      },
      categoriesLookup: { rules_version: "test", generated_at: "2026-01-01T00:00:00.000Z", dimensions: [] },
      minLookup: 2,
    });

    expect(report.invariants).toMatchObject({
      category_registry_categories: 1,
      category_public_categories: 1,
      category_assignments_repos: 1,
      category_has_language: true,
      category_has_language_family: false,
      category_single_owner_kind: false,
      category_unknown_refs: 0,
      categories_lookup_categories: 0,
    });
    expect(report.failures).toEqual([
      "categories/assignments: only 1 repos",
      "categories/assignments: language_family must have at least one category per repo",
      "categories/assignments: owner_kind must have exactly one category per repo",
      "lookup/categories: empty",
    ]);
    expect(report.publicCategories.map((category) => category.id)).toEqual(["language/typescript"]);
  });
});

function repoLookup(full_name: string, current_stars: number) {
  const [owner, name] = full_name.split("/");
  return { owner, name, full_name, owner_type: "Organization" as const, language: "TypeScript", current_stars, active: true, tracked_since: null };
}

const HISTORY_RUN = "refresh-history-marker";
const HISTORY_AT = "2026-10-25T00:00:00.000Z";
const HISTORY_REPO_COUNT = 1000;
const PRIOR_YEAR = String(new Date().getUTCFullYear() - 1);
const HISTORY_MARKER = {
  seed_date: "2026-10-19",
  monthly: "unavailable",
  prior_year_heatmap: "unavailable",
  set_at: "2026-10-25T00:00:00.000Z",
} as const;
const EMPTY_CURVE_FAILURE = "entity/repo/1: empty curve";
const MISSING_HEATMAP_FAILURE = `heatmap/year/${PRIOR_YEAR}.json: missing`;

const historyUniverse = (() => {
  const lookup: Record<string, ReturnType<typeof repoLookup>> = {};
  const searchRepos = [];
  const assignments: Record<string, Record<string, string[]>> = {};
  const entries = [];
  for (let id = 1; id <= HISTORY_REPO_COUNT; id++) {
    const fullName = `example/repo-${id}`;
    lookup[String(id)] = repoLookup(fullName, 10000);
    searchRepos.push({ id, full_name: fullName, owner: "example", language: "TypeScript", current_stars: 10000, description: null, active: true, tracked_since: "2026-10-19" });
    assignments[String(id)] = {
      language: ["language/typescript"],
      language_family: ["language_family/typed"],
      domain: ["domain/tools"],
      project_type: ["project_type/library"],
      ecosystem: ["ecosystem/node"],
      owner_kind: ["owner_kind/organization"],
      maturity: ["maturity/established"],
    };
    entries.push({ id, node_id: `R_${id}`, full_name: fullName, owner: "example", name: `repo-${id}`, stars: 10000 });
  }
  return { lookup, searchRepos, assignments, entries, starsSum: HISTORY_REPO_COUNT * 10000 };
})();

function historyCategory(dimension: string, slug: string, isPublic = false) {
  return {
    id: `${dimension}/${slug}`,
    dimension,
    slug,
    label: slug,
    count: isPublic ? 1 : HISTORY_REPO_COUNT,
    public: isPublic,
    sitemap: false,
    minimum_repo_count: 0,
  };
}

function historyEntity(id: number, monthly: Array<[string, number, number]>) {
  return {
    id,
    full_name: `example/repo-${id}`,
    owner: "example",
    owner_type: "Organization" as const,
    name: `repo-${id}`,
    description: null,
    language: "TypeScript",
    topics: [],
    created_at: "2020-01-01",
    current_stars: 10000,
    active: true,
    tracked_since: "2026-10-19",
    is_archived: false,
    milestones: { crossed_10k: null, crossed_50k: null, crossed_100k: null },
    curve: { monthly, recent_daily: [] },
    monthly_table: [],
  };
}

type HistoryGateCase = {
  env?: Record<string, string | undefined>;
  marker?: "absent" | "valid" | "malformed" | "unreadable";
  heatmap?: "missing" | "malformed" | "present";
  topEntity?: "empty" | "present" | "missing";
  pointer?: boolean;
};

async function runHistoryGate(options: HistoryGateCase = {}) {
  const marker = options.marker ?? "absent";
  const heatmap = options.heatmap ?? "missing";
  const topEntity = options.topEntity ?? "empty";
  const pointer = options.pointer ?? true;
  const envKeys = ["DEPLOY_ENV", "VERCEL_ENV", "WORKFLOW_COLD_START"] as const;
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  Object.assign(process.env, options.env ?? { DEPLOY_ENV: "pre" });
  const logs: unknown[][] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[workflow-refresh] ")) logs.push(args);
  });
  const readView = spyOn(source, "readAuthoritativeView").mockImplementation(async (path: string, schema: { parse: (data: unknown) => unknown }) => {
    if (path === HISTORY_AVAILABILITY_KEY && marker === "unreadable") throw new Error("history marker unreadable");
    const value = historyArtifact(path, { marker, heatmap, topEntity, pointer });
    if (value == null) return null;
    return schema.parse(value);
  });
  const validateCanonical = spyOn(canonical, "validateCanonicalGeneration").mockResolvedValue({
    manifest: {
      run_id: HISTORY_RUN,
      generated_at: HISTORY_AT,
      expected_shards: 0,
      validated_shards: 0,
      total_records: HISTORY_REPO_COUNT,
      complete: true,
      shards: [],
    },
    checked: 0,
    schemaFailures: 0,
    invariants: {},
    failures: [],
    placeholders: [],
    repoIds: new Set(Object.keys(historyUniverse.lookup)),
    activeRepoIds: new Set(Object.keys(historyUniverse.lookup)),
    acc: canonical.emptyCanonicalPreflightAcc(),
  });
  let stored: unknown;
  const writeView = spyOn(write, "putView").mockImplementation(async (path: string, data: unknown) => {
    if (path === `ops/workflows/${HISTORY_RUN}/validation.json`) stored = data;
  });
  try {
    const validation = await validateVersion(HISTORY_RUN);
    return { validation, logs };
  } catch (error) {
    if (stored) return { validation: stored as Awaited<ReturnType<typeof validateVersion>>, logs };
    throw error;
  } finally {
    readView.mockRestore();
    validateCanonical.mockRestore();
    writeView.mockRestore();
    log.mockRestore();
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
}

function historyArtifact(
  path: string,
  options: Required<Pick<HistoryGateCase, "marker" | "heatmap" | "topEntity" | "pointer">>,
): unknown {
  if (path === HISTORY_AVAILABILITY_KEY) {
    if (options.marker === "absent" || options.marker === "unreadable") return null;
    if (options.marker === "malformed") return { monthly: "unavailable" };
    return HISTORY_MARKER;
  }
  const packed = /recompute\/(month|week|year)-win\/meta\.json$/.exec(path);
  if (packed) return { v: 1, kind: packed[1], seamPeriod: "2026-09", periods: [], buckets: REPO_BUCKETS, complete: true };
  if (path === "views/latest.json") {
    return options.pointer
      ? { version: "refresh-prev", run_id: "refresh-prev", published_at: HISTORY_AT, prev_version: null, schema_ver: 1 }
      : null;
  }
  if (path === `views/${HISTORY_RUN}/meta.json`) {
    return {
      seam_date: "2026-10-19",
      schema_ver: 1,
      active_repo_count: HISTORY_REPO_COUNT,
      historical_repo_count: 0,
      generated_at: HISTORY_AT,
      folded_through: { month: "2026-09", week: "2026-W39" },
    };
  }
  if (path === `views/${HISTORY_RUN}/rank/all-time/repo/stock.json`) {
    return {
      meta: { window: "all", period: "all", dim: "repo", metric: "stock", generated_at: HISTORY_AT },
      items: [{ rank: 1, id: 1, value: 10000, prev_rank: null }],
    };
  }
  if (path === `views/${HISTORY_RUN}/rank/all-time/org/stock.json`) {
    return {
      meta: { window: "all", period: "all", dim: "org", metric: "stock", generated_at: HISTORY_AT },
      items: [{ rank: 1, login: "example", value: historyUniverse.starsSum, prev_rank: null }],
    };
  }
  if (path === `views/${HISTORY_RUN}/lookup/repos.json`) return historyUniverse.lookup;
  if (path === `views/${HISTORY_RUN}/lookup/orgs.json`) {
    return { example: { login: "example", owner_type: "Organization", repo_count: HISTORY_REPO_COUNT, current_stars_sum: historyUniverse.starsSum } };
  }
  if (path === `canonical/v2/whitelist/${HISTORY_RUN}.json`) {
    return { run_id: HISTORY_RUN, generated_at: HISTORY_AT, count: HISTORY_REPO_COUNT, entries: historyUniverse.entries, diff: { added: [], dropped: [] } };
  }
  if (path === `views/${HISTORY_RUN}/lookup/aliases.json`) return {};
  if (path === `views/${HISTORY_RUN}/search/index.json`) {
    return { generated_at: HISTORY_AT, count: HISTORY_REPO_COUNT, repos: historyUniverse.searchRepos };
  }
  if (path === `views/${HISTORY_RUN}/categories/registry.json`) {
    return {
      rules_version: "test",
      generated_at: HISTORY_AT,
      dimensions: [
        ["language", "typescript", true],
        ["language_family", "typed", false],
        ["domain", "tools", false],
        ["project_type", "library", false],
        ["ecosystem", "node", false],
        ["owner_kind", "organization", false],
        ["maturity", "established", false],
      ].map(([dimension, slug, isPublic]) => ({
        id: dimension,
        label: String(dimension),
        categories: [historyCategory(String(dimension), String(slug), isPublic === true)],
      })),
    };
  }
  if (path === `views/${HISTORY_RUN}/categories/assignments.json`) {
    return { rules_version: "test", generated_at: HISTORY_AT, repositories: historyUniverse.assignments };
  }
  if (path === `views/${HISTORY_RUN}/lookup/categories.json`) {
    return {
      rules_version: "test",
      generated_at: HISTORY_AT,
      dimensions: [{ id: "language", label: "Language", categories: [{ id: "language/typescript", slug: "typescript", label: "TypeScript", count: 1, sitemap: false }] }],
    };
  }
  if (path === "views/" + HISTORY_RUN + "/rank/category/language/typescript/all-time/repo/stock.json") {
    return {
      meta: {
        window: "all",
        period: "all",
        dim: "repo",
        metric: "stock",
        generated_at: HISTORY_AT,
        category: { id: "language/typescript", dimension: "language", slug: "typescript" },
      },
      items: [],
    };
  }
  const repoEntity = new RegExp(`^views/${HISTORY_RUN}/entity/repo/(\\d+)\\.json$`).exec(path);
  if (repoEntity) {
    const id = Number(repoEntity[1]);
    if (id === 1 && options.topEntity === "missing") return null;
    const monthly = id === 1 && options.topEntity === "present" ? [["2026-09", 1, 10000] as [string, number, number]] : [];
    return historyEntity(id, id === 1 ? monthly : []);
  }
  if (path === `views/${HISTORY_RUN}/entity/org/example.json`) {
    return {
      login: "example",
      owner_type: "Organization",
      current_stars_sum: historyUniverse.starsSum,
      repo_count: HISTORY_REPO_COUNT,
      members: [1],
      curve: { monthly: [], recent_daily: [] },
    };
  }
  if (path === `views/${HISTORY_RUN}/heatmap/year/${PRIOR_YEAR}.json`) {
    if (options.heatmap === "missing") return null;
    if (options.heatmap === "malformed") return { cells: [] };
    return {
      meta: { scope: "year", period: PRIOR_YEAR, generated_at: HISTORY_AT },
      cells: [[`${PRIOR_YEAR}-12`, 1]],
    };
  }
  return null;
}

describe("publication history gates and the preview history marker", () => {
  test("a valid preview marker accepts an empty sampled monthly curve and a missing prior-year heatmap", async () => {
    const { validation, logs } = await runHistoryGate({ marker: "valid" });
    expect(validation.ok).toBe(true);
    expect(validation.failures).toEqual([]);
    expect(validation.schema_failures).toBe(0);
    expect(validation.invariants).toMatchObject({
      sample_curve_months: 0,
      history_unavailable_empty_curve_relaxed: true,
      history_unavailable_missing_prior_year_heatmap_relaxed: true,
      cold_start_empty_curve_relaxed: false,
      cold_start_missing_prior_year_heatmap_relaxed: false,
    });
    expect(logs).toEqual([
      ["[workflow-refresh] history-unavailable validation relaxed", { run_id: HISTORY_RUN, check: EMPTY_CURVE_FAILURE }],
      ["[workflow-refresh] history-unavailable validation relaxed", { run_id: HISTORY_RUN, check: MISSING_HEATMAP_FAILURE }],
    ]);
  });

  test("an absent marker keeps today's empty-curve and missing-heatmap failures", async () => {
    const { validation, logs } = await runHistoryGate({ marker: "absent" });
    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual([EMPTY_CURVE_FAILURE, MISSING_HEATMAP_FAILURE]);
    expect(validation.invariants).toMatchObject({
      history_unavailable_empty_curve_relaxed: false,
      history_unavailable_missing_prior_year_heatmap_relaxed: false,
      cold_start_empty_curve_relaxed: false,
      cold_start_missing_prior_year_heatmap_relaxed: false,
    });
    expect(logs).toEqual([]);
  });

  test("a malformed marker stays strict", async () => {
    const { validation } = await runHistoryGate({ marker: "malformed" });
    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual([EMPTY_CURVE_FAILURE, MISSING_HEATMAP_FAILURE]);
  });

  test("an unreadable marker fails the gate and does not open either exception", async () => {
    const { validation } = await runHistoryGate({ marker: "unreadable" });
    expect(validation.ok).toBe(false);
    expect(validation.schema_failures).toBeGreaterThan(0);
    expect(validation.failures).toEqual([
      `${HISTORY_AVAILABILITY_KEY}: schema — history marker unreadable`,
      EMPTY_CURVE_FAILURE,
      MISSING_HEATMAP_FAILURE,
    ]);
    expect(validation.invariants).toMatchObject({
      history_unavailable_empty_curve_relaxed: false,
      history_unavailable_missing_prior_year_heatmap_relaxed: false,
    });
  });

  test("a malformed prior-year heatmap still fails when the marker is valid", async () => {
    const { validation } = await runHistoryGate({ marker: "valid", heatmap: "malformed" });
    expect(validation.ok).toBe(false);
    expect(validation.schema_failures).toBeGreaterThan(0);
    expect(validation.failures.some((failure) => failure.startsWith(`heatmap/year/${PRIOR_YEAR}.json: schema`))).toBe(true);
    expect(validation.failures).not.toContain(EMPTY_CURVE_FAILURE);
    expect(validation.invariants.history_unavailable_missing_prior_year_heatmap_relaxed).toBe(false);
    expect(validation.invariants.history_unavailable_empty_curve_relaxed).toBe(true);
  });

  test("a missing sampled entity still fails when the marker is valid", async () => {
    const { validation } = await runHistoryGate({ marker: "valid", topEntity: "missing" });
    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain("entity/repo/1.json: missing");
    expect(validation.failures).not.toContain(EMPTY_CURVE_FAILURE);
    expect(validation.invariants.history_unavailable_empty_curve_relaxed).toBe(false);
    expect(validation.invariants.history_unavailable_missing_prior_year_heatmap_relaxed).toBe(true);
  });

  test.each([
    ["production", { DEPLOY_ENV: "production" }],
    ["a production signal on preview", { DEPLOY_ENV: "pre", VERCEL_ENV: "production" }],
    ["an unset deployment", {}],
  ] as const)("%s stays strict with a valid marker", async (_label, env) => {
    const { validation, logs } = await runHistoryGate({ marker: "valid", env });
    expect(validation.ok).toBe(false);
    expect(validation.failures).toEqual([EMPTY_CURVE_FAILURE, MISSING_HEATMAP_FAILURE]);
    expect(validation.invariants).toMatchObject({
      history_unavailable_empty_curve_relaxed: false,
      history_unavailable_missing_prior_year_heatmap_relaxed: false,
    });
    expect(logs).toEqual([]);
  });

  test("present history does not record either marker exception", async () => {
    const { validation, logs } = await runHistoryGate({ marker: "valid", heatmap: "present", topEntity: "present" });
    expect(validation.ok).toBe(true);
    expect(validation.failures).toEqual([]);
    expect(validation.invariants).toMatchObject({
      sample_curve_months: 1,
      history_unavailable_empty_curve_relaxed: false,
      history_unavailable_missing_prior_year_heatmap_relaxed: false,
    });
    expect(logs).toEqual([]);
  });

  test("first publication without a marker still uses the cold-start exception", async () => {
    const { validation, logs } = await runHistoryGate({
      marker: "absent",
      pointer: false,
      env: { DEPLOY_ENV: "pre", WORKFLOW_COLD_START: "1" },
    });
    expect(validation.ok).toBe(true);
    expect(validation.failures).toEqual([]);
    expect(validation.invariants).toMatchObject({
      cold_start_empty_curve_relaxed: true,
      cold_start_missing_prior_year_heatmap_relaxed: true,
      history_unavailable_empty_curve_relaxed: false,
      history_unavailable_missing_prior_year_heatmap_relaxed: false,
    });
    expect(logs).toEqual([
      ["[workflow-refresh] cold-start validation relaxed", { run_id: HISTORY_RUN, check: EMPTY_CURVE_FAILURE }],
      ["[workflow-refresh] cold-start validation relaxed", { run_id: HISTORY_RUN, check: MISSING_HEATMAP_FAILURE }],
    ]);
  });
});
