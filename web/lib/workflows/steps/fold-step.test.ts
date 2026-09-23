import { describe, expect, test } from "bun:test";
import type { CanonicalMeta, PendingPeriod, RepoMonthlyShard, RepoWeeklyShard, SiteDaily } from "@/lib/contracts";
import type { FoldCursorAcc } from "@/lib/workflows/runtime/types";
import {
  FOLD_BUCKETS_PER_JOB,
  coercePendingPeriod,
  dropPendingReposOutsideBuckets,
  foldBucketWindow,
  foldCanonical,
  foldStepCheckpointName,
  hasNextFoldWindow,
  monthPlanFromPending,
  pendingFlowsForBuckets,
  runFoldStep,
  type FoldDecision,
  type FoldIo,
  type FoldMonthPlan,
  type FoldStepFields,
  type FoldWeekPlan,
} from "./fold";
import type { RefreshCursor } from "@/lib/workflows/runtime/types";

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
  monthPlan: FoldMonthPlan | null;
  weekPlan: FoldWeekPlan | null;
  decision: FoldDecision | null;
  pendingReads: string[];
  monthlyReads: number[];
  weeklyReads: number[];
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
    monthPlan: null as FoldMonthPlan | null,
    weekPlan: null as FoldWeekPlan | null,
    decision: null as FoldDecision | null,
    pendingReads: [] as string[],
    monthlyReads: [] as number[],
    weeklyReads: [] as number[],
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
      io.monthlyReads.push(bucket);
      return structuredClone(monthly.get(bucket) ?? emptyShard());
    },
    async readWeeklyShard(bucket: number) {
      io.weeklyReads.push(bucket);
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
    async readMonthPlan() {
      return io.monthPlan ? structuredClone(io.monthPlan) : null;
    },
    async writeMonthPlan(plan: FoldMonthPlan) {
      io.monthPlan = structuredClone(plan);
    },
    async readWeekPlan() {
      return io.weekPlan ? structuredClone(io.weekPlan) : null;
    },
    async writeWeekPlan(plan: FoldWeekPlan) {
      io.weekPlan = structuredClone(plan);
    },
    async writeDecision(decision: FoldDecision) {
      io.decision = structuredClone(decision);
    },
  };
  return io;
}

function cursorFrom(step: FoldStepFields): RefreshCursor {
  return {
    foldPhase: step.nextFoldPhase,
    foldMonth: step.nextFoldMonth,
    foldOffset: step.nextFoldOffset,
    foldSeq: step.nextFoldSeq,
    foldAcc: step.foldAcc,
  };
}

describe("fold window helpers", () => {
  test("splits buckets into 1-wide windows", () => {
    expect(FOLD_BUCKETS_PER_JOB).toBe(1);
    expect(foldBucketWindow(0, 8)).toEqual([0]);
    expect(foldBucketWindow(4, 8)).toEqual([4]);
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

  test("monthPlanFromPending drops per_repo as it walks and keeps only non-zero flows", () => {
    const pending = structuredClone(pendingAug);
    pending.per_repo["2"] = [["2026-08-01", 0]];
    const plan = monthPlanFromPending(pending, 8);
    expect(pending.per_repo).toEqual({});
    expect(plan.month).toBe("2026-08");
    expect(plan.daily_totals).toEqual(pendingAug.daily_totals);
    expect(plan.buckets[1]).toEqual([[1, 14]]);
    expect(plan.buckets[4]).toEqual([[4, 4]]);
    expect(plan.buckets[2]).toEqual([]);
  });
});

describe("runFoldStep windows", () => {
  const now = new Date("2026-09-15T00:00:00.000Z");

  test("first month hop writes a compact plan and does not touch monthly shards", async () => {
    const io = memoryFoldIo();
    const first = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    expect(first.nextFoldPhase).toBe("month");
    expect(first.nextFoldMonth).toBe("2026-08");
    expect(first.nextFoldOffset).toBe(0);
    expect(first.folded).toEqual([]);
    expect(io.meta.folded_through.month).toBe("2026-07");
    expect(io.monthPlan?.month).toBe("2026-08");
    expect(io.monthPlan?.buckets[1]).toEqual([[1, 14]]);
    expect(io.monthPlan?.buckets[4]).toEqual([[4, 4]]);
    expect(io.decision).toEqual({
      currentMonth: "2026-09",
      foldedThroughMonth: "2026-07",
      foldedThroughWeek: "2026-W30",
      nextFoldMonth: "2026-08",
      monthPlan: true,
      weekPlan: false,
      reason: "month_plan",
    });
    expect(io.monthlyReads).toEqual([]);
    expect(io.monthly.size).toBe(0);
    expect(io.pendingReads).toEqual(["2026-08"]);
  });

  test("a retry after the month plan exists writes one shard and does not reread pending", async () => {
    const io = memoryFoldIo();
    const planHop = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    io.pendingReads = [];
    const shard0 = await runFoldStep("refresh-fold", 1, cursorFrom(planHop), { io, now, buckets: 8 });
    expect(io.pendingReads).toEqual([]);
    expect(io.monthlyReads).toEqual([0]);
    expect(shard0.nextFoldPhase).toBe("month");
    expect(shard0.nextFoldMonth).toBe("2026-08");
    expect(shard0.nextFoldOffset).toBe(1);
    expect(io.monthly.get(1)).toBeUndefined();
  });

  test("last month window writes site-daily and hands off to week without computing weeks", async () => {
    const io = memoryFoldIo();
    let cursor: RefreshCursor = {};
    let last = await runFoldStep("refresh-fold", 1, cursor, { io, now, buckets: 8 });
    for (let offset = 0; offset < 8; offset++) {
      expect(last.nextFoldPhase).toBe("month");
      cursor = cursorFrom(last);
      last = await runFoldStep("refresh-fold", 1, cursor, { io, now, buckets: 8 });
    }
    expect(last.nextFoldPhase).toBe("week");
    expect(last.nextFoldOffset).toBe(0);
    expect(last.folded).toEqual(["2026-08"]);
    expect(io.monthly.get(1)?.["1"]).toEqual([["2026-08", 14]]);
    expect(io.monthly.get(4)?.["4"]).toEqual([["2026-08", 4]]);
    expect(io.site.get("2026")?.cells).toEqual([
      ["2026-08-03", 10],
      ["2026-08-15", 4],
    ]);
    expect(io.weekPlan).toBeNull();
    expect(io.weeklyReads).toEqual([]);
    expect(io.meta.folded_through.month).toBe("2026-07");
    expect(io.monthlyReads).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("week-0 reads pendings one at a time, writes a compact plan, and does not write weekly shards", async () => {
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
    expect(week0.nextFoldOffset).toBe(0);
    expect(week0.foldedWeeks[0]).toBe("2026-W31");
    expect(io.weeklyReads).toEqual([]);
    expect(io.weekly.size).toBe(0);
    expect(io.meta.folded_through.week).toBe("2026-W30");
  });

  test("a retry after the week plan exists writes one weekly shard and does not reread pending", async () => {
    const io = memoryFoldIo();
    const acc: FoldCursorAcc = {
      folded: ["2026-08"],
      foldedWeeks: [],
      foldedThroughMonth: "2026-08",
      foldedThroughWeek: "2026-W30",
    };
    const planHop = await runFoldStep(
      "refresh-fold",
      1,
      { foldPhase: "week", foldOffset: 0, foldSeq: 2, foldAcc: acc },
      { io, now, buckets: 8 },
    );
    io.pendingReads = [];
    const shard0 = await runFoldStep("refresh-fold", 1, cursorFrom(planHop), { io, now, buckets: 8 });
    expect(io.pendingReads).toEqual([]);
    expect(io.weeklyReads).toEqual([0]);
    expect(shard0.nextFoldPhase).toBe("week");
    expect(shard0.nextFoldOffset).toBe(1);
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
    expect(io.monthlyReads).toHaveLength(8);
    expect(io.weeklyReads).toHaveLength(8);
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
    expect(io.monthPlan).toBeNull();
    expect(io.weekPlan).toBeNull();
    expect(io.decision).toEqual({
      currentMonth: "2026-09",
      foldedThroughMonth: "2026-08",
      foldedThroughWeek: "2026-W35",
      nextFoldMonth: null,
      monthPlan: false,
      weekPlan: false,
      reason: "no_closed_month",
    });
  });

  test("first hop with a current-month watermark and remaining weeks writes week_only", async () => {
    const io = memoryFoldIo();
    io.meta = {
      ...META,
      folded_through: { month: "2026-08", week: "2026-W30" },
    };
    const first = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    expect(first.nextFoldPhase).toBe("week");
    expect(first.nextFoldOffset).toBe(0);
    expect(io.monthPlan).toBeNull();
    expect(io.weekPlan?.weeks.length).toBeGreaterThan(0);
    expect(io.decision).toEqual({
      currentMonth: "2026-09",
      foldedThroughMonth: "2026-08",
      foldedThroughWeek: "2026-W30",
      nextFoldMonth: null,
      monthPlan: false,
      weekPlan: true,
      reason: "week_only",
    });
  });

  test("preview cold-start: meta at folded month without pending advances week watermark", async () => {
    const io = memoryFoldIo();
    io.readPending = async (month: string) => {
      io.pendingReads.push(month);
      return null;
    };
    io.meta = {
      ...META,
      folded_through: { month: "2026-08", week: "2026-W30" },
    };
    const result = await foldCanonical("refresh-fold", 1, {
      io,
      now,
      buckets: 8,
      relaxMissingFrozenPending: true,
    });
    expect(result.folded).toEqual([]);
    expect(result.foldedWeeks.length).toBeGreaterThan(0);
    expect(result.foldedWeeks.at(-1)).toBe("2026-W35");
    expect(io.meta.folded_through.week).toBe("2026-W35");
  });

  test("missing closed pending writes pending_missing and still finishes the hop", async () => {
    const io = memoryFoldIo();
    io.readPending = async (month: string) => {
      io.pendingReads.push(month);
      if (month === "2026-07") return structuredClone(pendingJul);
      return null;
    };
    const first = await runFoldStep("refresh-fold", 1, {}, { io, now, buckets: 8 });
    expect(hasNextFoldWindow(first)).toBe(false);
    expect(io.monthPlan).toBeNull();
    expect(io.decision).toEqual({
      currentMonth: "2026-09",
      foldedThroughMonth: "2026-07",
      foldedThroughWeek: "2026-W30",
      nextFoldMonth: "2026-08",
      monthPlan: false,
      weekPlan: false,
      reason: "pending_missing",
    });
  });

  test("coercePendingPeriod checks shape without walking daily series", () => {
    const raw = {
      period: "2026-08",
      frozen_at: "2026-09-01T00:00:00.000Z",
      daily_totals: [["2026-08-01", 1]],
      per_repo: { "1": [["2026-08-01", 1]] },
    };
    expect(coercePendingPeriod(raw, "2026-08").per_repo["1"]).toEqual([["2026-08-01", 1]]);
    expect(() => coercePendingPeriod({ period: "2026-07" }, "2026-08")).toThrow("does not match");
  });
});
