import { describe, expect, test } from "bun:test";
import type { CanonicalMeta, PendingPeriod, RepoMonthlyShard, RepoWeeklyShard, SiteDaily } from "@/lib/contracts";
import type { FoldCursorAcc } from "@/lib/workflows/runtime/types";
import {
  FOLD_BUCKETS_PER_JOB,
  dropPendingReposOutsideBuckets,
  foldBucketWindow,
  foldCanonical,
  foldStepCheckpointName,
  hasNextFoldWindow,
  pendingFlowsForBuckets,
  runFoldStep,
  type FoldIo,
  type FoldWeekPlan,
} from "./fold";

const META: CanonicalMeta = {
  seam_date: "2026-05-30",
  schema_ver: 1,
  folded_through: { month: "2026-07", week: "2026-W30" },
  generated_at: "2026-08-01T00:00:00.000Z",
};

const pendingJul: PendingPeriod = {
  period: "2026-07",
  frozen_at: "2026-08-01T00:00:00.000Z",
  daily_totals: [["2026-07-27", 1]],
  per_repo: {
    "1": [["2026-07-27", 1]],
  },
};

const pendingAug: PendingPeriod = {
  period: "2026-08",
  frozen_at: "2026-09-01T00:00:00.000Z",
  daily_totals: [
    ["2026-08-03", 10],
    ["2026-08-15", 4],
  ],
  per_repo: {
    "1": [
      ["2026-08-03", 10],
      ["2026-08-15", 4],
    ],
    "4": [["2026-08-15", 4]],
  },
};

function emptyShard(): Record<string, Array<[string, number]>> {
  return {};
}

function memoryFoldIo(): FoldIo & {
  monthly: Map<number, RepoMonthlyShard>;
  weekly: Map<number, RepoWeeklyShard>;
  site: Map<string, SiteDaily>;
  meta: CanonicalMeta;
  weekPlan: FoldWeekPlan | null;
  pendingReads: string[];
  maxInflight: number;
} {
  let inflight = 0;
  const monthly = new Map<number, RepoMonthlyShard>();
  const weekly = new Map<number, RepoWeeklyShard>();
  const site = new Map<string, SiteDaily>();
  const io = {
    monthly,
    weekly,
    site,
    meta: structuredClone(META),
    weekPlan: null as FoldWeekPlan | null,
    pendingReads: [] as string[],
    maxInflight: 0,
    async readMeta() {
      return structuredClone(io.meta);
    },
    async readPending(month: string) {
      inflight += 1;
      io.maxInflight = Math.max(io.maxInflight, inflight);
      io.pendingReads.push(month);
      inflight -= 1;
      if (month === "2026-07") return structuredClone(pendingJul);
      if (month === "2026-08") return structuredClone(pendingAug);
      return null;
    },
    async readMonthlyShard(bucket: number) {
      return structuredClone(monthly.get(bucket) ?? emptyShard());
    },
    async readWeeklyShard(bucket: number) {
      return structuredClone(weekly.get(bucket) ?? emptyShard());
    },
    async readSiteDaily(year: string) {
      return site.get(year) ? structuredClone(site.get(year)!) : null;
    },
    async writeMonthlyShard(bucket: number, shard: RepoMonthlyShard) {
      monthly.set(bucket, structuredClone(shard));
    },
    async writeWeeklyShard(bucket: number, shard: RepoWeeklyShard) {
      weekly.set(bucket, structuredClone(shard));
    },
    async writeSiteDaily(year: string, next: SiteDaily) {
      site.set(year, structuredClone(next));
    },
    async writeMeta(next: CanonicalMeta) {
      io.meta = structuredClone(next);
    },
    async readWeekPlan() {
      return io.weekPlan ? structuredClone(io.weekPlan) : null;
    },
    async writeWeekPlan(plan: FoldWeekPlan) {
      io.weekPlan = structuredClone(plan);
    },
  };
  return io;
}

describe("fold window helpers", () => {
  test("splits buckets into 4-wide windows", () => {
    expect(FOLD_BUCKETS_PER_JOB).toBe(4);
    expect(foldBucketWindow(0, 8)).toEqual([0, 1, 2, 3]);
    expect(foldBucketWindow(4, 8)).toEqual([4, 5, 6, 7]);
    expect(() => foldBucketWindow(8, 8)).toThrow("outside 8 buckets");
  });

  test("names checkpoints by phase and sequence", () => {
    expect(foldStepCheckpointName({})).toBe("fold-month-0");
    expect(foldStepCheckpointName({ foldPhase: "week", foldSeq: 2 })).toBe("fold-week-2");
  });

  test("hasNextFoldWindow is true only while a fold cursor remains", () => {
    expect(hasNextFoldWindow({ nextFoldPhase: "week", nextFoldOffset: 0 })).toBe(true);
    expect(hasNextFoldWindow({ folded: ["2026-08"], foldedWeeks: [] })).toBe(false);
  });

  test("pendingFlowsForBuckets keeps only the requested buckets and dropPendingReposOutsideBuckets mutates the rest away", () => {
    const pending = structuredClone(pendingAug);
    expect([...pendingFlowsForBuckets(pending, [1]).keys()]).toEqual([1]);
    dropPendingReposOutsideBuckets(pending, [1]);
    expect(Object.keys(pending.per_repo)).toEqual(["1"]);
  });
});

describe("runFoldStep windows", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");

  test("first month window does not write meta and asks for the next month buckets", async () => {
    const io = memoryFoldIo();
    const first = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    expect(first.nextFoldPhase).toBe("month");
    expect(first.nextFoldMonth).toBe("2026-08");
    expect(first.nextFoldOffset).toBe(4);
    expect(first.folded).toEqual([]);
    expect(io.meta.folded_through.month).toBe("2026-07");
    expect(io.monthly.get(1)?.["1"]).toEqual([["2026-08", 14]]);
    expect(io.monthly.get(4)).toBeUndefined();
  });

  test("last month window hands off to week-0 without computing weeks in the same isolate", async () => {
    const io = memoryFoldIo();
    const first = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    const lastMonth = await runFoldStep(
      "refresh-fold",
      1,
      {
        foldPhase: first.nextFoldPhase,
        foldMonth: first.nextFoldMonth,
        foldOffset: first.nextFoldOffset,
        foldSeq: first.nextFoldSeq,
        foldAcc: first.foldAcc,
      },
      { io, now, buckets: 8 },
    );
    expect(lastMonth.nextFoldPhase).toBe("week");
    expect(lastMonth.nextFoldOffset).toBe(0);
    expect(lastMonth.folded).toEqual(["2026-08"]);
    expect(io.monthly.get(4)?.["4"]).toEqual([["2026-08", 4]]);
    expect(io.site.get("2026")?.cells).toEqual([
      ["2026-08-03", 10],
      ["2026-08-15", 4],
    ]);
    expect(io.weekPlan).toBeNull();
    expect(io.meta.folded_through.month).toBe("2026-07");
  });

  test("week-0 reads pendings one at a time, writes a compact plan, and does not finish the graph", async () => {
    const io = memoryFoldIo();
    const acc: FoldCursorAcc = {
      folded: ["2026-08"],
      foldedWeeks: [],
      foldedThroughMonth: "2026-08",
      foldedThroughWeek: "2026-W30",
    };
    const week0 = await runFoldStep(
      "refresh-fold",
      1,
      { foldPhase: "week", foldOffset: 0, foldSeq: 2, foldAcc: acc },
      { io, now, buckets: 8 },
    );
    expect(io.pendingReads).toEqual(["2026-07", "2026-08"]);
    expect(io.maxInflight).toBe(1);
    expect(io.weekPlan?.weeks.some((row) => row.week === "2026-W32" && row.repos.some(([id, flow]) => id === 1 && flow === 10))).toBe(
      true,
    );
    expect(week0.nextFoldPhase).toBe("week");
    expect(week0.nextFoldOffset).toBe(4);
    expect(io.meta.folded_through.week).toBe("2026-W30");
  });

  test("foldCanonical drains windows and commits both watermarks", async () => {
    const io = memoryFoldIo();
    const result = await foldCanonical("refresh-fold", 1, { io, now, buckets: 8 });
    expect(result.folded).toEqual(["2026-08"]);
    expect(result.foldedWeeks[0]).toBe("2026-W31");
    expect(result.foldedWeeks.at(-1)).toBe("2026-W35");
    expect(io.meta.folded_through).toEqual({ month: "2026-08", week: "2026-W35" });
    expect(io.weekly.get(1)?.["1"]?.find(([week]) => week === "2026-W32")).toEqual(["2026-W32", 10]);
    expect(io.weekly.get(4)?.["4"]?.find(([week]) => week === "2026-W33")).toEqual(["2026-W33", 4]);
  });

  test("a fold with nothing to do returns empty lists and does not write meta", async () => {
    const io = memoryFoldIo();
    io.meta = {
      ...META,
      folded_through: { month: "2026-08", week: "2026-W35" },
    };
    const result = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    expect(hasNextFoldWindow(result)).toBe(false);
    expect(result).toEqual({ folded: [], foldedWeeks: [] });
    expect(io.meta.folded_through).toEqual({ month: "2026-08", week: "2026-W35" });
    expect(io.weekPlan).toBeNull();
  });
});
