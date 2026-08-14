// Canonical week-fold check (§8.3). The PURE per-repo week-flow core (computeWeekRows) needs no
// Blob I/O, so we feed it synthetic month pendings and assert the hard cases:
//   (a) a CROSS-MONTH ISO week (Jun 29–Jul 5 = 2026-W27) sums days from BOTH months' pendings;
//   (b) within-month weeks are correct;
//   (c) contiguity + the frozen-month boundary (W31 ends Aug 2 → excluded while M=2026-07), and a
//       zero-flow week (W30) is still emitted so the watermark stays gap-free.
//   bun run scripts/test-week-fold.ts

import type { PendingPeriod } from "../lib/contracts";
import { computeWeekRows } from "../lib/workflows/steps/fold";
import { sundayOfWeekId, weekIdOf } from "../lib/workflows/steps/week-dates";

let failures = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  const ok = g === w;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: got ${g} want ${w}`);
};

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

const asObj = (row: { week: string; perRepo: Map<number, number> }) => ({
  week: row.week,
  perRepo: Object.fromEntries([...row.perRepo.entries()].sort((a, b) => a[0] - b[0])),
});

// --- main scenario: fromWeek=W26 (so W27 is the first candidate), last frozen month = 2026-07 ---
{
  const rows = computeWeekRows(pendings, "2026-W26", "2026-07");
  // contiguous + ascending, bounded by the frozen month: W27..W30 (W31 ends Aug 2 → out).
  eq("(c) folded weeks (contiguous, W31 boundary excluded)", rows.map((r) => r.week), [
    "2026-W27",
    "2026-W28",
    "2026-W29",
    "2026-W30",
  ]);
  const byWeek = new Map(rows.map((r) => [r.week, r]));
  // (a) cross-month week: BOTH months' matching days summed per repo.
  eq("(a) cross-month W27 flow = June+July days", asObj(byWeek.get("2026-W27")!), {
    week: "2026-W27",
    perRepo: { 1: 15, 33: 8 },
  });
  // (b) within-month weeks.
  eq("(b) within-month W28 flow", asObj(byWeek.get("2026-W28")!), { week: "2026-W28", perRepo: { 1: 100 } });
  eq("(b) within-month W29 flow", asObj(byWeek.get("2026-W29")!), { week: "2026-W29", perRepo: { 2: 50 } });
  // (c) zero-flow week still emitted (no deltas Jul 20–26) so the watermark advances past it.
  eq("(c) zero-flow W30 emitted with empty perRepo", asObj(byWeek.get("2026-W30")!), {
    week: "2026-W30",
    perRepo: {},
  });
  // sanity: the W26 +5 delta (≤ fromWeek) and the W31 +999 delta (boundary) leak nowhere.
  const allFlow = rows.flatMap((r) => [...r.perRepo.values()]).reduce((a, b) => a + b, 0);
  eq("excluded deltas (W26 +5, W31 +999) leak nowhere", allFlow, 15 + 8 + 100 + 50);
}

// --- boundary advances with M: once August freezes, W31 (Jul 27–Aug 2) becomes foldable, and
// every contiguous week ending ≤ Aug 31 is emitted (W32–W35 are zero-flow but keep the watermark
// gap-free; W36 ends Sep 6 → still out). This proves the boundary tracks M, not the data. ---
{
  const rows = computeWeekRows(pendings, "2026-W30", "2026-08");
  eq("weeks foldable @M=2026-08 (contiguous through Aug-end)", rows.map((r) => r.week), [
    "2026-W31",
    "2026-W32",
    "2026-W33",
    "2026-W34",
    "2026-W35",
  ]);
  eq("W31 flow picks up the Jul 27 +999 day", asObj(rows[0]), { week: "2026-W31", perRepo: { 1: 999 } });
  // the trailing August weeks carry no data — emitted empty purely for contiguity.
  eq("W32–W35 are zero-flow (empty perRepo)", rows.slice(1).map((r) => asObj(r).perRepo), [{}, {}, {}, {}]);
}

// --- idempotency/contiguity: re-running from a later fromWeek resumes exactly after it ---
{
  const rows = computeWeekRows(pendings, "2026-W28", "2026-07");
  eq("resume after W28 → starts at W29 (no W27/W28 re-emit)", rows.map((r) => r.week), ["2026-W29", "2026-W30"]);
}

// --- ISO year-boundary sanity: W53 of a long year spans into the next Jan; ids must round-trip ---
{
  eq("2026-W53 Sunday is in 2027-01 (year-straddle week)", sundayOfWeekId("2026-W53"), "2027-01-03");
  eq("2026-W53 round-trips via weekIdOf(Sunday)", weekIdOf("2027-01-03"), "2026-W53");
}

console.log(failures === 0 ? "\nWEEK-FOLD MATH OK" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
