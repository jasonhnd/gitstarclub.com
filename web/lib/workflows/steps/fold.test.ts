// Unit tests for the PURE cores of the canonical week fold (§8.3) — no Blob I/O.
// computeWeekRows is the testable seam: given the FROZEN month pendings that cover the
// candidate weeks, it emits one WeekRow per ISO week (W > fromWeekExclusive, Sunday ≤
// end-of-foldedMonth), contiguously by +7 days, summing cross-month weeks from BOTH pendings.
// We do NOT test foldCanonical/foldMonth/foldWeeks here — those need Blob reads/writes.
import { test, expect, describe } from "bun:test";
import type { PendingPeriod } from "@/lib/contracts";
import { computeWeekRows, nextMonth, type WeekRow } from "./fold";

// repo→bucket is id % 32, so ids 1 and 33 share bucket 1 and id 2 is bucket 2. The pure core
// doesn't bucket, but using these ids keeps the fixtures aligned with the I/O layer's grouping.
//
// Layout of the synthetic deltas (ISO weeks in 2026):
//   W26  Jun 22 .. Jun 28    id1 +5                      (≤ fromWeek W26 → excluded)
//   W27  Jun 29 .. Jul 5     id1 10+3+2=15, id33 7+1=8   (CROSS-MONTH: June + July days)
//   W28  Jul 6 .. Jul 12     id1 +100
//   W29  Jul 13 .. Jul 19    id2 +50
//   W30  Jul 20 .. Jul 26    (no deltas → all-zero week)
//   W31  Jul 27 .. Aug 2     id1 +999                    (Sunday in Aug → excluded while M=Jul)
const pendingJun: PendingPeriod = {
  period: "2026-06",
  frozen_at: "2026-07-01T00:00:00.000Z",
  daily_totals: [],
  per_repo: {
    "1": [
      ["2026-06-22", 5], // W26 — must be excluded (≤ fromWeek)
      ["2026-06-30", 10], // W27, June side of the cross-month week
    ],
    "33": [["2026-06-29", 7]], // W27 Monday (June side)
  },
};

const pendingJul: PendingPeriod = {
  period: "2026-07",
  frozen_at: "2026-08-01T00:00:00.000Z",
  daily_totals: [],
  per_repo: {
    "1": [
      ["2026-07-01", 3], // W27 July side  → id1 W27 = 10 + 3 + 2 = 15
      ["2026-07-02", 2], // W27 July side
      ["2026-07-08", 100], // W28
      ["2026-07-27", 999], // W31 (Sunday Aug 2) → excluded while foldedMonth = 2026-07
    ],
    "33": [["2026-07-05", 1]], // W27 Sunday (July side) → id33 W27 = 7 + 1 = 8
    "2": [["2026-07-15", 50]], // W29
  },
};

const pendings = [pendingJun, pendingJul];

// Stable plain-object snapshot of a WeekRow (perRepo Map → sorted-key object) for deep equality.
const asObj = (row: WeekRow): { week: string; perRepo: Record<number, number> } => ({
  week: row.week,
  perRepo: Object.fromEntries([...row.perRepo.entries()].sort((a, b) => a[0] - b[0])),
});

describe("nextMonth", () => {
  test("December rolls into the next January", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  test("within-year increment is zero-padded", () => {
    expect(nextMonth("2026-01")).toBe("2026-02");
    expect(nextMonth("2026-08")).toBe("2026-09");
    expect(nextMonth("2026-09")).toBe("2026-10"); // single → double digit
    expect(nextMonth("2026-11")).toBe("2026-12");
  });
});

describe("computeWeekRows — fromWeek=W26, foldedMonth=2026-07", () => {
  const rows = computeWeekRows(pendings, "2026-W26", "2026-07");
  const byWeek = new Map(rows.map((r) => [r.week, r]));

  test("(c) contiguity: weeks enumerated by +7 days, ascending, bounded by the frozen month", () => {
    // W27..W30 inclusive. W31's Sunday (Aug 2) is past end-of-July, so it is NOT included.
    expect(rows.map((r) => r.week)).toEqual(["2026-W27", "2026-W28", "2026-W29", "2026-W30"]);
  });

  test("(a) a CROSS-MONTH ISO week sums days from BOTH months' pendings into one WeekRow", () => {
    // W27 pulls id1 from June (10) + July (3+2) = 15 and id33 from June (7) + July (1) = 8.
    expect(asObj(byWeek.get("2026-W27")!)).toEqual({ week: "2026-W27", perRepo: { 1: 15, 33: 8 } });
  });

  test("(b) within-month weeks are correct", () => {
    expect(asObj(byWeek.get("2026-W28")!)).toEqual({ week: "2026-W28", perRepo: { 1: 100 } });
    expect(asObj(byWeek.get("2026-W29")!)).toEqual({ week: "2026-W29", perRepo: { 2: 50 } });
  });

  test("(c) an all-zero week is still emitted (empty perRepo) so the watermark stays gap-free", () => {
    // No deltas land Jul 20–26, but W30 must appear so folded_through.week advances past it.
    const w30 = byWeek.get("2026-W30");
    expect(w30).toBeDefined();
    expect(w30!.perRepo.size).toBe(0);
    expect(asObj(w30!)).toEqual({ week: "2026-W30", perRepo: {} });
  });

  test("(d) only weeks whose Sunday ≤ endOfMonth(foldedMonth) are included", () => {
    // W31 (Sun Aug 2) is excluded; its +999 delta leaks into no emitted row.
    expect(byWeek.has("2026-W31")).toBe(false);
    const total = rows.flatMap((r) => [...r.perRepo.values()]).reduce((a, b) => a + b, 0);
    expect(total).toBe(15 + 8 + 100 + 50); // = 173; W26's +5 and W31's +999 are both absent
  });

  test("excluded W26 delta (≤ fromWeek) is not in the first emitted week", () => {
    expect(byWeek.has("2026-W26")).toBe(false);
    // id1 only carries its W27 total (15), never the W26 +5.
    expect(byWeek.get("2026-W27")!.perRepo.get(1)).toBe(15);
  });
});

describe("computeWeekRows — (e) net-zero repos are dropped from a row's perRepo", () => {
  // Within one ISO week (W28: Jul 6–12) a repo's deltas cancel to zero; it must vanish from
  // perRepo, while a sibling repo with non-zero net survives in the SAME row.
  const cancelPending: PendingPeriod = {
    period: "2026-07",
    frozen_at: "2026-08-01T00:00:00.000Z",
    daily_totals: [],
    per_repo: {
      "1": [
        ["2026-07-06", 5],
        ["2026-07-08", -5], // id1 nets to 0 across W28 → dropped
      ],
      "2": [["2026-07-07", 9]], // id2 nets to 9 → kept
    },
  };
  const rows = computeWeekRows([cancelPending], "2026-W27", "2026-07");
  const w28 = rows.find((r) => r.week === "2026-W28")!;

  test("the net-zero repo is absent from perRepo", () => {
    expect(w28.perRepo.has(1)).toBe(false);
  });

  test("a non-zero sibling repo in the same week is retained", () => {
    expect(w28.perRepo.get(2)).toBe(9);
  });

  test("the WeekRow itself still exists (watermark must advance past a net-zero week)", () => {
    expect(rows.some((r) => r.week === "2026-W28")).toBe(true);
  });
});

describe("computeWeekRows — boundary tracks foldedMonth, not the data (M = 2026-08)", () => {
  // Once August freezes, W31 (Jul 27–Aug 2) becomes foldable and every contiguous week ending
  // ≤ Aug 31 is emitted. W32–W35 carry no deltas but are emitted purely for contiguity.
  const rows = computeWeekRows(pendings, "2026-W30", "2026-08");

  test("(c)/(d) contiguous through Aug-end; W36 (Sun Sep 6) excluded", () => {
    expect(rows.map((r) => r.week)).toEqual(["2026-W31", "2026-W32", "2026-W33", "2026-W34", "2026-W35"]);
  });

  test("W31 now picks up the Jul 27 +999 day", () => {
    expect(asObj(rows[0])).toEqual({ week: "2026-W31", perRepo: { 1: 999 } });
  });

  test("trailing empty weeks are emitted with empty perRepo (contiguity only)", () => {
    expect(rows.slice(1).map((r) => r.perRepo.size)).toEqual([0, 0, 0, 0]);
  });
});

describe("computeWeekRows — resume semantics (idempotent re-run from a later fromWeek)", () => {
  test("a later fromWeek resumes exactly after it, never re-emitting earlier weeks", () => {
    const rows = computeWeekRows(pendings, "2026-W28", "2026-07");
    expect(rows.map((r) => r.week)).toEqual(["2026-W29", "2026-W30"]);
  });

  test("when no candidate week's Sunday fits the frozen month, no rows are produced", () => {
    // fromWeek = W30 but foldedMonth = July: the first candidate (W31) ends Aug 2 > Jul 31.
    expect(computeWeekRows(pendings, "2026-W30", "2026-07")).toEqual([]);
  });
});

describe("computeWeekRows — ISO year-boundary cross-month week (2026-W53)", () => {
  // W53 = Mon 2026-12-28 .. Sun 2027-01-03: a cross-MONTH and cross-YEAR week. Days from the
  // December pending and the January pending must collapse into the single 2026-W53 row.
  const pendingDec: PendingPeriod = {
    period: "2026-12",
    frozen_at: "2027-01-01T00:00:00.000Z",
    daily_totals: [],
    per_repo: { "1": [["2026-12-28", 4]] }, // Monday (Dec side)
  };
  const pendingJan: PendingPeriod = {
    period: "2027-01",
    frozen_at: "2027-02-01T00:00:00.000Z",
    daily_totals: [],
    per_repo: { "1": [["2027-01-03", 6]] }, // Sunday (Jan side)
  };

  test("the straddling week sums Dec + Jan days into one 2026-W53 WeekRow", () => {
    const rows = computeWeekRows([pendingDec, pendingJan], "2026-W52", "2027-01");
    const w53 = rows.find((r) => r.week === "2026-W53")!;
    expect(w53).toBeDefined();
    expect(w53.perRepo.get(1)).toBe(10); // 4 (Dec) + 6 (Jan)
  });
});
