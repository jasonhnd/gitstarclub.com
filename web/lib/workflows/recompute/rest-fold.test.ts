import { describe, expect, test } from "bun:test";
import { CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsShardPath } from "@/lib/data/category-assignment-shards";
import { REPO_BUCKETS, repoBucket } from "../buckets";
import { categoryAssignmentShardDocument, categoryAssignmentsIndexDocument, categoryViewsFromAggregates, computeCategoryViews } from "./categories";
import { lookups, searchIndex } from "./entities";
import { buildModel, type RawShards, type RepoMeta } from "./model";
import { allTime, newcomers } from "./ranks";
import {
  allTimeViewsFromCarry,
  categoryAggregatesFromPartials,
  emptyRestCarry,
  foldRestBucket,
  newcomerViewsFromCarry,
  orgLookupFromCarry,
  repoLookupFromPartials,
  searchIndexFromPartials,
} from "./rest-fold";

const GEN = "2026-06-05T00:00:00Z";

function repo(id: number, extra: Partial<RepoMeta> = {}): RepoMeta {
  const owner = extra.owner ?? `owner${id}`;
  return {
    id,
    owner,
    owner_type: extra.owner_type ?? "User",
    name: extra.name ?? `repo${id}`,
    full_name: extra.full_name ?? `${owner}/repo${id}`,
    current_stars: extra.current_stars ?? 10_000,
    d: extra.d ?? 1,
    active: extra.active,
    description: extra.description,
    language: extra.language,
    languages: extra.languages,
    topics: extra.topics,
    crossed_10k: extra.crossed_10k,
    tracked_since: extra.tracked_since,
    is_archived: extra.is_archived,
  };
}

function asViews(views: Map<string, unknown>) {
  return Object.fromEntries([...views.entries()].sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0)));
}

describe("rest bucket fold matches the full model", () => {
  test("all-time, newcomers, lookups, search, and categories survive one-bucket folds", () => {
    const rows = [
      repo(1, {
        owner: "ai",
        owner_type: "Organization",
        name: "torch-lib",
        full_name: "ai/torch-lib",
        description: "Machine learning library",
        language: "Python",
        topics: ["machine-learning", "library", "python"],
        current_stars: 120_000,
        crossed_10k: "2026-01-01",
      }),
      repo(32, {
        owner: "ai",
        owner_type: "User",
        name: "old-lab",
        full_name: "ai/old-lab",
        description: "earlier lab notes",
        language: "Python",
        current_stars: 30_000,
        crossed_10k: "2024-05-01",
      }),
      repo(2, {
        owner: "py",
        name: "fast-api-tools",
        full_name: "py/fast-api-tools",
        description: "Python API toolkit",
        language: "Python",
        topics: ["python", "api", "tool"],
        current_stars: 80_000,
        crossed_10k: "2025-06-15",
      }),
      repo(3, {
        owner: "systems",
        name: "rust-cli",
        full_name: "systems/rust-cli",
        description: "Command line utility",
        language: "Rust",
        topics: ["rust", "cli"],
        current_stars: 40_000,
        active: false,
        crossed_10k: "2023-02-02",
      }),
    ];
    const repos: Record<string, RepoMeta> = {};
    for (const row of rows) repos[String(row.id)] = row;
    const model = buildModel({ repos, monthly: {}, weekly: {}, recentDaily: {}, siteDailyByYear: {} } as unknown as RawShards, "");
    const carry = emptyRestCarry(GEN);
    const partials = Array.from({ length: REPO_BUCKETS }, () => foldRestBucket(carry, []));
    for (const row of rows) {
      partials[repoBucket(row.id)] = foldRestBucket(carry, [row]);
    }

    expect(asViews(allTimeViewsFromCarry(carry))).toEqual(asViews(allTime(model, GEN)));
    const newer = new Map<string, unknown>([...newcomers(model, "month", GEN), ...newcomers(model, "year", GEN)]);
    expect(asViews(newcomerViewsFromCarry(carry))).toEqual(asViews(newer));
    const lookup = lookups(model);
    expect(repoLookupFromPartials(partials)).toEqual(lookup.get("lookup/repos.json") as ReturnType<typeof repoLookupFromPartials>);
    expect(orgLookupFromCarry(carry)).toEqual(lookup.get("lookup/orgs.json") as ReturnType<typeof orgLookupFromCarry>);
    expect(orgLookupFromCarry(carry).ai?.owner_type).toBe("Organization");
    expect(searchIndexFromPartials(partials, GEN)).toEqual(
      searchIndex(model, GEN).get("search/index.json") as ReturnType<typeof searchIndexFromPartials>,
    );

    const monolithic = computeCategoryViews(model, GEN);
    const aggregates = categoryAggregatesFromPartials(partials);
    const sharded = categoryViewsFromAggregates(GEN, aggregates.counts, aggregates.languageLabels, aggregates.members);
    sharded.set(CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsIndexDocument(GEN));
    for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
      sharded.set(categoryAssignmentsShardPath(bucket), categoryAssignmentShardDocument(bucket, GEN, partials[bucket]!.assignments));
    }
    expect(asViews(sharded)).toEqual(asViews(monolithic));
  });

  test("all-time and newcomers keep only the global top 100 across buckets", () => {
    const rows: RepoMeta[] = [];
    for (let n = 0; n < 105; n++) {
      rows.push(repo(1 + n * 32, { current_stars: 10_000 + n, crossed_10k: "2026-03-01", owner: `o${n}` }));
    }
    rows.push(repo(2, { current_stars: 9_000, crossed_10k: "2026-03-02", owner: "small" }));
    const repos: Record<string, RepoMeta> = {};
    for (const row of rows) repos[String(row.id)] = row;
    const model = buildModel({ repos, monthly: {}, weekly: {}, recentDaily: {}, siteDailyByYear: {} } as unknown as RawShards, "");
    const carry = emptyRestCarry(GEN);
    const byBucket = new Map<number, RepoMeta[]>();
    for (const row of rows) {
      const bucket = repoBucket(row.id);
      const list = byBucket.get(bucket) ?? [];
      list.push(row);
      byBucket.set(bucket, list);
    }
    for (const list of byBucket.values()) foldRestBucket(carry, list);
    expect(asViews(allTimeViewsFromCarry(carry))).toEqual(asViews(allTime(model, GEN)));
    expect(allTimeViewsFromCarry(carry).get("rank/all-time/repo/stock.json")?.items).toHaveLength(100);
    const newer = new Map<string, unknown>([...newcomers(model, "month", GEN), ...newcomers(model, "year", GEN)]);
    expect(asViews(newcomerViewsFromCarry(carry))).toEqual(asViews(newer));
  });
});
