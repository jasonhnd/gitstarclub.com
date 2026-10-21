import { describe, expect, test } from "bun:test";
import { RankList } from "@/lib/contracts";
import { AGGREGATE_HISTORY_PROVENANCE as provenance } from "@/lib/contracts/star-history";
import { buildModel, type RawShards, type RepoMeta } from "./model";
import { computeOrgWindow, computeRepoWindow } from "./windows";
import { orgRankMatrix, repoRankMatrix, type RankView } from "./ranks";
import {
  absorbOrgPeriodRowsFromBucket, appendRepoPeriodRowsFromBucket, coercePackedWindowBucket,
  createPackedWindowBuilder, orgRankViewsFromPeriodRows, orgRowsFromAbsorbed, packedBucketFile,
  packedOrgRankViewsForPeriod, packedRepoRankViewsForPeriod, packedWindowAsFlatBucket,
  repoRankViewsFromPeriodRows, type PackedPeriodOrgRow, type PackedPeriodRepoRow,
} from "./packed-window";

const GEN = "2026-10-22T00:00:00Z";
const WEEK = "2026-W23";
type Spec = { id: number; owner?: string; imported?: boolean; weekly?: Array<[string, number]> };

function fixture(specs: Spec[]) {
  const raw: RawShards = { repos: {}, weekly: {}, monthly: {}, recentDaily: {}, siteDailyByYear: {} };
  for (const spec of specs) {
    const owner = spec.owner ?? `owner${spec.id}`;
    raw.repos[String(spec.id)] = {
      id: spec.id, owner, owner_type: "Organization", name: `repo${spec.id}`,
      full_name: `${owner}/repo${spec.id}`, current_stars: 100, d: 1,
      ...(spec.imported ? { aggregate_history: { provenance, weeks: [WEEK] } } : {}),
    } as RepoMeta;
    raw.weekly[String(spec.id)] = spec.weekly ?? [[WEEK, spec.id]];
  }
  const model = buildModel(raw, "2026-05-30");
  const builder = createPackedWindowBuilder(model.seam.week);
  for (const id of model.ids) {
    const repo = model.repos.get(id)!;
    builder.absorb(id, repo.owner, true, repo.d, model.weekly.get(id)!, new Set(repo.aggregate_history?.weeks));
  }
  return { model, packed: builder.finalize() };
}

/** Compare full-object, in-memory packed and persisted v1/v2 bucket paths. */
function rankPaths(specs: Spec[]) {
  const { model, packed } = fixture(specs);
  const repo = computeRepoWindow(model, "week");
  const org = computeOrgWindow(model, repo);
  const object = new Map([...repoRankMatrix(repo, "week", GEN), ...orgRankMatrix(org, "week", GEN)]);
  const memory = new Map<string, RankView>();
  const carry = new Float64Array(packed.ids.length);
  let prevRepoFlow: Map<string, number> | undefined;
  let prevRepoStock: Map<string, number> | undefined;
  let prevOrgFlow: Map<string, number> | undefined;
  let prevOrgStock: Map<string, number> | undefined;
  for (let i = 0; i < packed.periods.length; i++) {
    const repoRank = packedRepoRankViewsForPeriod(packed, i, "week", GEN, prevRepoFlow, prevRepoStock);
    const orgRank = packedOrgRankViewsForPeriod(packed, i, "week", GEN, carry, prevOrgFlow, prevOrgStock);
    for (const [path, view] of [...repoRank.views, ...orgRank.views]) memory.set(path, view);
    prevRepoFlow = repoRank.nextFlow; prevRepoStock = repoRank.nextStock;
    prevOrgFlow = orgRank.nextFlow; prevOrgStock = orgRank.nextStock;
  }
  expect(memory).toEqual(object);
  for (const version of [1, 2]) {
    const repoRows: PackedPeriodRepoRow[][] = packed.periods.map(() => []);
    const orgRows = packed.periods.map(() => new Map<string, Omit<PackedPeriodOrgRow, "login">>());
    const orgCarry = new Map<number, number>();
    const shards = version === 1
      ? [packedBucketFile(packed, 0, 2), packedBucketFile(packed, 1, 2)]
      : [packedWindowAsFlatBucket(packed)];
    for (const shard of shards) {
      const restored = coercePackedWindowBucket(JSON.parse(JSON.stringify(shard)))!;
      appendRepoPeriodRowsFromBucket(restored, 0, packed.periods.length, repoRows);
      absorbOrgPeriodRowsFromBucket(restored, 0, packed.periods.length, orgCarry, orgRows);
    }
    prevRepoFlow = prevRepoStock = prevOrgFlow = prevOrgStock = undefined;
    for (let i = 0; i < packed.periods.length; i++) {
      const repoRank = repoRankViewsFromPeriodRows(packed.periods[i]!, repoRows[i]!, "week", GEN, prevRepoFlow, prevRepoStock);
      const orgRank = orgRankViewsFromPeriodRows(packed.periods[i]!, orgRowsFromAbsorbed(orgRows[i]!), "week", GEN, prevOrgFlow, prevOrgStock);
      for (const [path, view] of [...repoRank.views, ...orgRank.views]) {
        expect(view).toEqual(object.get(path)!);
        expect(RankList.safeParse(view).success).toBe(true);
      }
      prevRepoFlow = repoRank.nextFlow; prevRepoStock = repoRank.nextStock;
      prevOrgFlow = orgRank.nextFlow; prevOrgStock = orgRank.nextStock;
    }
  }
  return object;
}

function expectSource(views: Map<string, RankView>, period: string, source: "existing" | "aggregate" | "mixed") {
  for (const dim of ["repo", "org"]) {
    const flow = views.get(`rank/week/${period}/${dim}/flow.json`)!;
    expect(flow.meta.provenance).toEqual(source === "existing" ? undefined : provenance);
    expect(flow.meta.provenance_scope).toBe(source === "mixed" ? "mixed" : undefined);
    const stock = views.get(`rank/week/${period}/${dim}/stock.json`)!;
    expect(stock.meta.provenance).toBeUndefined();
    expect(stock.meta.provenance_scope).toBeUndefined();
  }
}

describe("weekly source composition", () => {
  test("pure existing weeks retain their legacy shape", () => {
    expectSource(rankPaths([{ id: 1 }, { id: 2 }]), WEEK, "existing");
  });
  test("pure aggregate weeks retain the approved source object", () => {
    expectSource(rankPaths([{ id: 1, imported: true }, { id: 2, imported: true }]), WEEK, "aggregate");
  });
  test.each([false, true])("mixed weeks, shared owner %s, retain both sources even with observed zero", (shared) => {
    const views = rankPaths([{ id: 1, imported: true, owner: shared ? "same" : "first" },
      { id: 2, owner: shared ? "same" : "second", weekly: [[WEEK, 0]] }]);
    expectSource(views, WEEK, "mixed");
    expect(views.get(`rank/week/${WEEK}/repo/flow.json`)!.items.map((row) => row.value)).toEqual([1, 0]);
  });
  test("idle stock carry never imports a prior week's source into current flow", () => {
    const views = rankPaths([
      { id: 1, owner: "same", imported: true },
      { id: 2, owner: "same", weekly: [["2026-W24", 2]] },
      { id: 3, weekly: [[WEEK, 3]] },
    ]);
    expectSource(views, WEEK, "mixed");
    expectSource(views, "2026-W24", "existing");
    expect(views.get("rank/week/2026-W24/org/stock.json")!.items.some((row) => row.login === "same")).toBe(false);
  });
  test.each([false, true])("only displayed top-100 sources label a board, aggregate leaders %s", (imported) => {
    const specs = Array.from({ length: 100 }, (_, i) => ({ id: i + 2, imported }));
    expectSource(rankPaths([{ id: 1, imported: !imported }, ...specs]), WEEK, imported ? "aggregate" : "existing");
  });
  test("empty boards do not acquire source metadata", () => {
    const views = repoRankViewsFromPeriodRows(WEEK, [], "week", GEN, undefined, undefined).views;
    for (const view of views.values()) expect(view.meta.provenance).toBeUndefined();
  });
  test("optional scope preserves old reads and rejects unsupported or unscoped mixes", () => {
    const legacy: RankList = { meta: { window: "week", period: WEEK, dim: "repo", metric: "flow", generated_at: GEN }, items: [] };
    expect(RankList.parse(legacy)).toEqual(legacy);
    const aggregate: RankList = { ...legacy, meta: { ...legacy.meta, provenance } };
    expect(RankList.parse(aggregate)).toEqual(aggregate);
    const mixed: RankList = { ...aggregate, meta: { ...aggregate.meta, provenance_scope: "mixed" } };
    expect(RankList.parse(mixed)).toEqual(mixed);
    for (const meta of [
      { ...legacy.meta, provenance_scope: "mixed" },
      { ...mixed.meta, provenance_scope: "unknown" },
      { ...mixed.meta, window: "month", period: "2026-06" },
      { ...mixed.meta, metric: "stock" },
    ]) expect(RankList.safeParse({ ...legacy, meta }).success).toBe(false);
  });
});
