import { describe, expect, test } from "bun:test";
import { buildModel, type RawShards, type RepoMeta } from "./model";
import { computeOrgWindow, computeRepoWindow, deriveYearWindow } from "./windows";
import { growth, orgRankMatrix, repoRankMatrix } from "./ranks";
import {
  absorbOrgPeriodRowsFromBucket,
  appendRepoPeriodRowsFromBucket,
  assemblePackedWindow,
  assignPackedFlowRanks,
  coercePackedWindowBucket,
  createPackedWindowBuilder,
  derivePackedYearWindow,
  orgRankViewsFromPeriodRows,
  orgRowsFromAbsorbed,
  packedBucketFile,
  packedGrowthViews,
  packedMetaFile,
  packedOrgPeriodRows,
  packedOrgRankViewsForPeriod,
  packedRepoRankViewsForPeriod,
  packedRepoRows,
  packedWindowAsFlatBucket,
  repoRankViewsFromPeriodRows,
  type PackedPeriodRepoRow,
  type PackedRepoWindow,
} from "./packed-window";

const SEAM_DATE = "2026-05-30";
const GEN = "2026-06-03T00:00:00Z";

type RepoSpec = {
  id: number;
  owner: string;
  owner_type?: "User" | "Organization";
  current_stars: number;
  d: number;
  active?: boolean;
  monthly?: Array<[string, number]>;
  weekly?: Array<[string, number]>;
};

function makeModel(specs: RepoSpec[], seamDate = SEAM_DATE) {
  const repos: Record<string, RepoMeta> = {};
  const monthly: Record<string, Array<[string, number]>> = {};
  const weekly: Record<string, Array<[string, number]>> = {};
  const recentDaily: Record<string, []> = {};
  for (const spec of specs) {
    const key = String(spec.id);
    repos[key] = {
      id: spec.id,
      owner: spec.owner,
      owner_type: spec.owner_type ?? "User",
      name: `r${spec.id}`,
      full_name: `${spec.owner}/r${spec.id}`,
      current_stars: spec.current_stars,
      d: spec.d,
      active: spec.active,
    };
    monthly[key] = spec.monthly ?? [];
    weekly[key] = spec.weekly ?? [];
    recentDaily[key] = [];
  }
  return buildModel({ repos, monthly, weekly, recentDaily, siteDailyByYear: {} } as unknown as RawShards, seamDate);
}

function packFromModel(model: ReturnType<typeof makeModel>, w: "month" | "week"): PackedRepoWindow {
  const builder = createPackedWindowBuilder(model.seam[w]);
  for (const id of model.ids) {
    const meta = model.repos.get(id)!;
    const series = w === "week" ? model.weekly.get(id) ?? [] : model.monthly.get(id) ?? [];
    if (series.length === 0) continue;
    builder.absorb(id, meta.owner, meta.active !== false, meta.d, series);
  }
  return builder.finalize();
}

function packedRepoRankMap(packed: PackedRepoWindow, w: "month" | "week" | "year") {
  const out = new Map<string, unknown>();
  let prevFlow: Map<string, number> | undefined;
  let prevStock: Map<string, number> | undefined;
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const ranked = packedRepoRankViewsForPeriod(packed, periodIndex, w, GEN, prevFlow, prevStock);
    for (const [path, view] of ranked.views) out.set(path, view);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
  }
  return out;
}

function packedOrgRankMap(packed: PackedRepoWindow, w: "month" | "week" | "year") {
  const out = new Map<string, unknown>();
  const carry = new Float64Array(packed.ids.length);
  let prevFlow: Map<string, number> | undefined;
  let prevStock: Map<string, number> | undefined;
  for (let periodIndex = 0; periodIndex < packed.periods.length; periodIndex++) {
    const ranked = packedOrgRankViewsForPeriod(packed, periodIndex, w, GEN, carry, prevFlow, prevStock);
    for (const [path, view] of ranked.views) out.set(path, view);
    prevFlow = ranked.nextFlow;
    prevStock = ranked.nextStock;
  }
  return out;
}

describe("packed window matches object window stock", () => {
  test("pre-seam gross × d, then post-seam net on the frozen anchor", () => {
    const model = makeModel([
      { id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-04", 100], ["2026-05", 50], ["2026-06", 30]] },
    ]);
    const packed = packFromModel(model, "month");
    expect(packedRepoRows(packed, 0).map((row) => [row.period, row.stock_est, row.cumgross])).toEqual(
      computeRepoWindow(model, "month").byRepo.get(1)!.map((row) => [row.period, row.stock_est, row.cumgross]),
    );
  });

  test("d=0 newcomer negative opening flow floors at 0", () => {
    const model = makeModel([{ id: 1, owner: "o", current_stars: 4, d: 0, monthly: [["2026-06", -8], ["2026-07", 12]] }]);
    expect(packedRepoRows(packFromModel(model, "month"), 0).map((row) => row.stock_est)).toEqual([0, 4]);
  });

  test("week window uses the week seam", () => {
    const model = makeModel([
      { id: 1, owner: "o", current_stars: 80, d: 0.5, weekly: [["2026-W21", 40], ["2026-W22", 60], ["2026-W23", 20]] },
    ]);
    expect(packedRepoRows(packFromModel(model, "week"), 0).map((row) => [row.period, row.stock_est])).toEqual([
      ["2026-W21", 20],
      ["2026-W22", 50],
      ["2026-W23", 70],
    ]);
  });
});

describe("packed ranks match object-window ranks", () => {
  test("repo flow/stock views including prev_rank from the full prior ranking", () => {
    const model = makeModel([
      { id: 1, owner: "o", current_stars: 50, d: 1, monthly: [["2026-01", 50], ["2026-02", 10]] },
      { id: 2, owner: "o", current_stars: 30, d: 1, monthly: [["2026-01", 30], ["2026-02", 40]] },
    ]);
    const object = repoRankMatrix(computeRepoWindow(model, "month"), "month", GEN);
    const packed = packedRepoRankMap(packFromModel(model, "month"), "month");
    expect([...packed.keys()].sort()).toEqual([...object.keys()].sort());
    for (const [path, view] of object) {
      expect(packed.get(path)).toEqual(view);
    }
  });

  test("caps top-100 and keeps prev_rank 101 for a needle that was outside top-100", () => {
    const specs: RepoSpec[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      owner: "o",
      current_stars: 0,
      d: 1,
      monthly: [
        ["2026-01", 1000 - i],
        ["2026-02", 1],
      ],
    }));
    specs.push({ id: 999, owner: "o", current_stars: 0, d: 1, monthly: [["2026-01", 1], ["2026-02", 5000]] });
    const model = makeModel(specs);
    const packed = packedRepoRankMap(packFromModel(model, "month"), "month");
    const second = packed.get("rank/month/2026-02/repo/flow.json") as { items: Array<{ id: number; rank: number; prev_rank: number | null }> };
    const needle = second.items.find((item) => item.id === 999)!;
    expect(needle.rank).toBe(1);
    expect(needle.prev_rank).toBe(101);
  });

  test("org idle members carry stock into later periods", () => {
    const model = makeModel([
      { id: 1, owner: "org", owner_type: "Organization", current_stars: 50, d: 1, monthly: [["2026-04", 30], ["2026-05", 20]] },
      { id: 2, owner: "org", owner_type: "Organization", current_stars: 70, d: 1, monthly: [["2026-04", 70]] },
    ]);
    const packed = packFromModel(model, "month");
    const carry = new Float64Array(packed.ids.length);
    const april = packedOrgPeriodRows(packed, packed.periods.indexOf("2026-04"), carry);
    const may = packedOrgPeriodRows(packed, packed.periods.indexOf("2026-05"), carry);
    expect(april).toEqual([{ login: "org", flow: 100, stock_est: 100 }]);
    expect(may).toEqual([{ login: "org", flow: 20, stock_est: 120 }]);
  });

  test("org ranks match computeOrgWindow + orgRankMatrix", () => {
    const model = makeModel([
      { id: 1, owner: "beta", owner_type: "Organization", current_stars: 100, d: 1, monthly: [["2026-01", 100]] },
      { id: 2, owner: "alpha", owner_type: "Organization", current_stars: 100, d: 1, monthly: [["2026-01", 100]] },
    ]);
    const object = orgRankMatrix(computeOrgWindow(model, computeRepoWindow(model, "month")), "month", GEN);
    const packed = packedOrgRankMap(packFromModel(model, "month"), "month");
    expect([...packed.keys()].sort()).toEqual([...object.keys()].sort());
    for (const [path, view] of object) {
      expect(packed.get(path)).toEqual(view);
    }
  });

  test("year ranks match deriveYearWindow", () => {
    const model = makeModel([
      { id: 1, owner: "o", current_stars: 150, d: 0.8, monthly: [["2026-04", 100], ["2026-05", 50], ["2026-06", 30]] },
      { id: 2, owner: "o", current_stars: 80, d: 1, monthly: [["2025-12", 20], ["2026-01", 10]] },
    ]);
    const year = deriveYearWindow(model, computeRepoWindow(model, "month"));
    const object = repoRankMatrix(year, "year", GEN);
    const packed = packedRepoRankMap(derivePackedYearWindow(packFromModel(model, "month")), "year");
    expect([...packed.keys()].sort()).toEqual([...object.keys()].sort());
    for (const [path, view] of object) {
      expect(packed.get(path)).toEqual(view);
    }
  });

  test("growth views match", () => {
    const model = makeModel([
      {
        id: 1,
        owner: "o",
        current_stars: 30000,
        d: 1,
        monthly: [
          ["2026-01", 25000],
          ["2026-02", 5000],
        ],
      },
    ]);
    const object = growth(computeRepoWindow(model, "month"), "month", GEN);
    const packed = packedGrowthViews(packFromModel(model, "month"), "month", GEN);
    expect([...packed.keys()].sort()).toEqual([...object.keys()].sort());
    for (const [path, view] of object) {
      expect(packed.get(path)).toEqual(view);
    }
  });
});

describe("week stream extract matches assembled window ranks", () => {
  test("v1 and v2 buckets yield the same repo and org ranks as the full packed window", () => {
    const model = makeModel([
      { id: 1, owner: "org", owner_type: "Organization", current_stars: 50, d: 1, weekly: [["2026-W20", 10], ["2026-W21", 20], ["2026-W22", 5], ["2026-W23", 8]] },
      { id: 2, owner: "org", owner_type: "Organization", current_stars: 70, d: 1, weekly: [["2026-W20", 70], ["2026-W22", 4]] },
      { id: 33, owner: "solo", current_stars: 12, d: 1, weekly: [["2026-W21", 3], ["2026-W22", 9], ["2026-W23", 1]] },
    ]);
    const packed = packFromModel(model, "week");
    const v1 = packedBucketFile(packed, 0, 1);
    const v2 = packedWindowAsFlatBucket(packed);
    expect(coercePackedWindowBucket(v2)?.v).toBe(2);

    const fromFull = packedRepoRankMap(packed, "week");
    const fromOrg = packedOrgRankMap(packed, "week");

    for (const shard of [v1, v2]) {
      const repoRows = packed.periods.map(() => [] as PackedPeriodRepoRow[]);
      appendRepoPeriodRowsFromBucket(shard, 0, packed.periods.length, repoRows);
      const orgCarry = new Map<number, number>();
      const orgAcc = packed.periods.map(() => new Map<string, { flow: number; stock_est: number }>());
      absorbOrgPeriodRowsFromBucket(shard, 0, packed.periods.length, orgCarry, orgAcc);

      let prevFlow: Map<string, number> | undefined;
      let prevStock: Map<string, number> | undefined;
      const streamedRepo = new Map<string, unknown>();
      for (let i = 0; i < packed.periods.length; i++) {
        const ranked = repoRankViewsFromPeriodRows(packed.periods[i]!, repoRows[i]!, "week", GEN, prevFlow, prevStock);
        for (const [path, view] of ranked.views) streamedRepo.set(path, view);
        prevFlow = ranked.nextFlow;
        prevStock = ranked.nextStock;
      }
      expect(streamedRepo).toEqual(fromFull);

      prevFlow = undefined;
      prevStock = undefined;
      const streamedOrg = new Map<string, unknown>();
      for (let i = 0; i < packed.periods.length; i++) {
        const ranked = orgRankViewsFromPeriodRows(packed.periods[i]!, orgRowsFromAbsorbed(orgAcc[i]!), "week", GEN, prevFlow, prevStock);
        for (const [path, view] of ranked.views) streamedOrg.set(path, view);
        prevFlow = ranked.nextFlow;
        prevStock = ranked.nextStock;
      }
      expect(streamedOrg).toEqual(fromOrg);
    }
  });

  test("period windows keep prev_rank and org idle-member stock carry", () => {
    const model = makeModel([
      { id: 1, owner: "org", owner_type: "Organization", current_stars: 50, d: 1, weekly: [["2026-W20", 30], ["2026-W21", 20], ["2026-W22", 10]] },
      { id: 2, owner: "org", owner_type: "Organization", current_stars: 70, d: 1, weekly: [["2026-W20", 70]] },
    ]);
    const packed = packFromModel(model, "week");
    const shard = packedWindowAsFlatBucket(packed);
    const carry = new Map<number, number>();
    const firstAcc = [new Map<string, { flow: number; stock_est: number }>()];
    absorbOrgPeriodRowsFromBucket(shard, 0, 1, carry, firstAcc);
    const secondAcc = [new Map<string, { flow: number; stock_est: number }>(), new Map<string, { flow: number; stock_est: number }>()];
    absorbOrgPeriodRowsFromBucket(shard, 1, 3, carry, secondAcc);
    expect(orgRowsFromAbsorbed(firstAcc[0]!)).toEqual([{ login: "org", flow: 100, stock_est: 100 }]);
    expect(orgRowsFromAbsorbed(secondAcc[0]!)).toEqual([{ login: "org", flow: 20, stock_est: 120 }]);
    expect(orgRowsFromAbsorbed(secondAcc[1]!)).toEqual([{ login: "org", flow: 10, stock_est: 130 }]);
  });
});

describe("packed persist codec", () => {
  test("bucket files reassemble an equivalent window", () => {
    const model = makeModel([
      { id: 1, owner: "o", current_stars: 10, d: 1, monthly: [["2026-01", 4], ["2026-02", 6]] },
      { id: 33, owner: "p", current_stars: 8, d: 1, monthly: [["2026-01", 8]] },
    ]);
    const packed = packFromModel(model, "month");
    const meta = packedMetaFile("month", model.seam.month, packed, 32);
    const shards = [0, 1].map((bucket) => packedBucketFile(packed, bucket, 32));
    const again = assemblePackedWindow(meta, shards);
    expect(again.periods).toEqual(packed.periods);
    expect(again.ids.slice().sort((a, b) => a - b)).toEqual(packed.ids.slice().sort((a, b) => a - b));
    const ranks = assignPackedFlowRanks(packed);
    const object = computeRepoWindow(model, "month");
    for (let index = 0; index < packed.ids.length; index++) {
      const id = packed.ids[index]!;
      expect(packedRepoRows(packed, index, ranks).map((row) => row.flow_rank)).toEqual(
        object.byRepo.get(id)!.map((row) => row.flow_rank),
      );
    }
  });
});
