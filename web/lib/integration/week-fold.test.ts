// Canonical week-fold check §8.3 (port of scripts/test-week-fold.ts).
// The PURE per-repo week-flow core (computeWeekRows) needs no Blob I/O, so we feed it synthetic
// month pendings and assert the hard cases:
//   (a) a CROSS-MONTH ISO week (Jun 29–Jul 5 = 2026-W27) sums days from BOTH months' pendings;
//   (b) within-month weeks are correct;
//   (c) contiguity + the frozen-month boundary (W31 ends Aug 2 → excluded while M=2026-07), and a
//       zero-flow week (W30) is still emitted so the watermark stays gap-free;
//   (d) the boundary tracks M (not the data): once August freezes, W31 becomes foldable;
//   (e) idempotent resume from a later fromWeek; and ISO year-straddle id round-trips.
//   bun test lib/integration/week-fold.test.ts
import { test, expect, describe } from "bun:test";
import type { PendingPeriod } from "../contracts";
import { computeWeekRows, type WeekRow } from "../workflows/steps/fold";
import { sundayOfWeekId, weekIdOf } from "../workflows/steps/week-dates";

// repo→bucket is id % 32; ids 1 and 33 share bucket 1, id 2 is bucket 2 — exercises grouping.
const pendingJun: PendingPeriod = {
  period: "2026-06",
  frozen_at: "2026-07-01T00:00:00.000Z",
  daily_totals: [],
  per_repo: {
    "1": [
      ["2026-06-22", 5], // 2026-W26 — must be EXCLUDED (≤ fromWeek)
      ["2026-06-30", 10], // 2026-W27 (June half of the cross-month week)
    ],
    "33": [["2026-06-29", 7]], // 2026-W27 (Monday, June side)
  },
};
const pendingJul: PendingPeriod = {
  period: "2026-07",
  frozen_at: "2026-08-01T00:00:00.000Z",
  daily_totals: [],
  per_repo: {
    "1": [
      ["2026-07-01", 3], // 2026-W27 (July half) → id 1 W27 total = 10 + 3 + 2 = 15
      ["2026-07-02", 2], // 2026-W27 (July half)
      ["2026-07-08", 100], // 2026-W28 (within July)
      ["2026-07-27", 999], // 2026-W31 — Sunday Aug 2 > end-of-July → EXCLUDED while M=2026-07
    ],
    "33": [["2026-07-05", 1]], // 2026-W27 (Sunday, July side) → id 33 W27 total = 7 + 1 = 8
    "2": [["2026-07-15", 50]], // 2026-W29 (within July)
  },
};
const pendings = [pendingJun, pendingJul];

const asObj = (row: WeekRow) => ({
  week: row.week,
  perRepo: Object.fromEntries([...row.perRepo.entries()].sort((a, b) => a[0] - b[0])),
});

describe("week-fold core — main scenario @M=2026-07 (fromWeek=W26)", () => {
  const rows = computeWeekRows(pendings, "2026-W26", "2026-07");
  const byWeek = new Map(rows.map((r) => [r.week, r]));

  test("(c) folded weeks are contiguous & ascending, bounded by M (W31 ends Aug 2 → out)", () => {
    expect(rows.map((r) => r.week)).toEqual(["2026-W27", "2026-W28", "2026-W29", "2026-W30"]);
  });

  test("(a) cross-month W27 flow = June + July days summed per repo", () => {
    expect(asObj(byWeek.get("2026-W27")!)).toEqual({ week: "2026-W27", perRepo: { 1: 15, 33: 8 } });
  });

  test("(b) within-month W28 flow", () => {
    expect(asObj(byWeek.get("2026-W28")!)).toEqual({ week: "2026-W28", perRepo: { 1: 100 } });
  });

  test("(b) within-month W29 flow", () => {
    expect(asObj(byWeek.get("2026-W29")!)).toEqual({ week: "2026-W29", perRepo: { 2: 50 } });
  });

  test("(c) zero-flow W30 still emitted with empty perRepo (keeps watermark gap-free)", () => {
    expect(asObj(byWeek.get("2026-W30")!)).toEqual({ week: "2026-W30", perRepo: {} });
  });

  test("excluded deltas (W26 +5, W31 +999) leak nowhere", () => {
    const allFlow = rows.flatMap((r) => [...r.perRepo.values()]).reduce((a, b) => a + b, 0);
    expect(allFlow).toBe(15 + 8 + 100 + 50);
  });
});

describe("week-fold boundary tracks M, not the data (@M=2026-08)", () => {
  // Once August freezes, W31 (Jul 27–Aug 2) becomes foldable; every contiguous week ending
  // ≤ Aug 31 is emitted (W32–W35 zero-flow but keep the watermark gap-free; W36 ends Sep 6 → out).
  const rows = computeWeekRows(pendings, "2026-W30", "2026-08");

  test("weeks foldable @M=2026-08 run contiguously through Aug-end", () => {
    expect(rows.map((r) => r.week)).toEqual(["2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35"]);
  });

  test("W31 flow picks up the Jul 27 +999 day", () => {
    expect(asObj(rows[0])).toEqual({ week: "2026-W31", perRepo: { 1: 999 } });
  });

  test("W32–W35 are zero-flow (empty perRepo), emitted purely for contiguity", () => {
    expect(rows.slice(1).map((r) => asObj(r).perRepo)).toEqual([{}, {}, {}, {}]);
  });
});

describe("week-fold idempotency & ISO year-straddle", () => {
  test("resume after W28 → starts at W29 (no W27/W28 re-emit)", () => {
    const rows = computeWeekRows(pendings, "2026-W28", "2026-07");
    expect(rows.map((r) => r.week)).toEqual(["2026-W29", "2026-W30"]);
  });

  test("2026-W53 Sunday is in 2027-01 (year-straddle week)", () => {
    expect(sundayOfWeekId("2026-W53")).toBe("2027-01-03");
  });

  test("2026-W53 round-trips via weekIdOf(Sunday)", () => {
    expect(weekIdOf("2027-01-03")).toBe("2026-W53");
  });
});
