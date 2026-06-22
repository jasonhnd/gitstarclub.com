// Unit tests for the pure ISO-week date math behind the canonical week fold (VERCEL-DATA-OPERATIONS §7.2).
// Everything is UTC + string-in/string-out, so these are deterministic with no I/O.
// The hard case is ISO 8601 year boundaries: 2026 is a LONG ISO year (it has W53), and
// that week's days spill into Jan 2027 — the id↔date round-trip must still hold.
import { test, expect, describe } from "bun:test";
import {
  addDays,
  endOfMonth,
  isoMonday,
  isoSunday,
  mondayOfWeekId,
  monthOf,
  monthsBetween,
  sundayOfWeekId,
  weekIdOf,
} from "./week-dates";

describe("weekIdOf", () => {
  test("formats as zero-padded 'YYYY-Www'", () => {
    // Jan 4 is always in ISO week 1; a single-digit week stays padded.
    expect(weekIdOf("2026-01-04")).toBe("2026-W01");
    expect(weekIdOf("2026-06-29")).toBe("2026-W27"); // Monday of W27
    expect(weekIdOf("2026-07-15")).toBe("2026-W29");
  });

  test("Jan 1 belongs to the PREVIOUS ISO year when that week's Thursday is in Dec", () => {
    // 2027-01-01 is a Friday; its ISO week (W53) is anchored in 2026.
    expect(weekIdOf("2027-01-01")).toBe("2026-W53");
    expect(weekIdOf("2027-01-03")).toBe("2026-W53"); // Sunday of W53
    // ...but 2027-01-04 (Monday) starts 2027-W01.
    expect(weekIdOf("2027-01-04")).toBe("2027-W01");
  });
});

describe("mondayOfWeekId / sundayOfWeekId round-trip", () => {
  // The core invariant: weekIdOf(mondayOfWeekId(w)) === w and weekIdOf(sundayOfWeekId(w)) === w
  // for every id, across year boundaries. Spot-check a spread plus the W53 edge.
  const ids = [
    "2026-W01",
    "2026-W26",
    "2026-W27",
    "2026-W52",
    "2026-W53", // long-year final week (days fall into Jan 2027)
    "2027-W01",
    "2025-W01",
    "2024-W52",
  ];

  for (const id of ids) {
    test(`Monday of ${id} round-trips via weekIdOf`, () => {
      const monday = mondayOfWeekId(id);
      expect(weekIdOf(monday)).toBe(id);
    });
    test(`Sunday of ${id} round-trips via weekIdOf`, () => {
      const sunday = sundayOfWeekId(id);
      expect(weekIdOf(sunday)).toBe(id);
    });
    test(`Sunday of ${id} is exactly Monday + 6 days`, () => {
      expect(sundayOfWeekId(id)).toBe(addDays(mondayOfWeekId(id), 6));
    });
  }

  test("Monday of an ISO week is always a UTC Monday (day 1)", () => {
    for (const id of ids) {
      const d = new Date(`${mondayOfWeekId(id)}T00:00:00.000Z`);
      expect(d.getUTCDay()).toBe(1); // Monday
    }
  });

  test("Sunday of an ISO week is always a UTC Sunday (day 0)", () => {
    for (const id of ids) {
      const d = new Date(`${sundayOfWeekId(id)}T00:00:00.000Z`);
      expect(d.getUTCDay()).toBe(0); // Sunday
    }
  });
});

describe("ISO year-boundary: 2026-W53 (long ISO year)", () => {
  // 2026 has 53 ISO weeks; W53 = Mon 2026-12-28 .. Sun 2027-01-03 — it straddles the year.
  test("W53 spans Dec 28 2026 → Jan 3 2027", () => {
    expect(mondayOfWeekId("2026-W53")).toBe("2026-12-28");
    expect(sundayOfWeekId("2026-W53")).toBe("2027-01-03");
  });

  test("every day of W53 maps back to 2026-W53, including the Jan-2027 tail", () => {
    // Walk all 7 days from the Monday; the last 3 land in January 2027 but stay in 2026-W53.
    const monday = mondayOfWeekId("2026-W53");
    for (let i = 0; i < 7; i++) {
      expect(weekIdOf(addDays(monday, i))).toBe("2026-W53");
    }
    // explicit Jan-2027 days for clarity
    expect(weekIdOf("2027-01-01")).toBe("2026-W53");
    expect(weekIdOf("2027-01-02")).toBe("2026-W53");
    expect(weekIdOf("2027-01-03")).toBe("2026-W53");
  });

  test("W53 is contiguous with the next year's W01 (Monday + 7d = 2027-W01 Monday)", () => {
    expect(addDays(mondayOfWeekId("2026-W53"), 7)).toBe(mondayOfWeekId("2027-W01"));
    expect(mondayOfWeekId("2027-W01")).toBe("2027-01-04");
  });
});

describe("isoMonday / isoSunday (week of an arbitrary date)", () => {
  test("a date round-trips: weekIdOf(isoMonday(d)) === weekIdOf(isoSunday(d)) === weekIdOf(d)", () => {
    for (const d of ["2026-06-30", "2026-01-01", "2027-01-01", "2026-12-31", "2026-07-05"]) {
      const id = weekIdOf(d);
      expect(weekIdOf(isoMonday(d))).toBe(id);
      expect(weekIdOf(isoSunday(d))).toBe(id);
    }
  });

  test("Monday and Sunday bracket the same ISO week", () => {
    // 2026-06-30 (Tue) lives in W27: Mon 2026-06-29 .. Sun 2026-07-05.
    expect(isoMonday("2026-06-30")).toBe("2026-06-29");
    expect(isoSunday("2026-06-30")).toBe("2026-07-05");
  });

  test("isoMonday/isoSunday are idempotent on the week's own endpoints", () => {
    expect(isoMonday("2026-06-29")).toBe("2026-06-29"); // already Monday
    expect(isoSunday("2026-07-05")).toBe("2026-07-05"); // already Sunday
  });
});

describe("endOfMonth", () => {
  test("31-day, 30-day, and February (common + leap) months", () => {
    expect(endOfMonth("2026-01")).toBe("2026-01-31");
    expect(endOfMonth("2026-06")).toBe("2026-06-30");
    expect(endOfMonth("2026-07")).toBe("2026-07-31");
    expect(endOfMonth("2026-12")).toBe("2026-12-31");
    expect(endOfMonth("2026-02")).toBe("2026-02-28"); // not a leap year
    expect(endOfMonth("2024-02")).toBe("2024-02-29"); // leap year
  });

  test("a month that ENDS MID-WEEK (June 30 2026 is a Tuesday) — its Sunday crosses into July", () => {
    // This is exactly why cross-month weeks exist in the fold: June's last day is mid-week.
    const last = endOfMonth("2026-06"); // 2026-06-30
    expect(last).toBe("2026-06-30");
    expect(new Date(`${last}T00:00:00.000Z`).getUTCDay()).toBe(2); // Tuesday
    expect(isoSunday(last)).toBe("2026-07-05"); // the week's Sunday is in July
    expect(weekIdOf(last)).toBe(weekIdOf("2026-07-05")); // same ISO week spans both months
  });
});

describe("monthsBetween", () => {
  test("single month when both ends share it", () => {
    expect(monthsBetween("2026-06-01", "2026-06-30")).toEqual(["2026-06"]);
  });

  test("inclusive ascending span across a year boundary", () => {
    expect(monthsBetween("2026-11-15", "2027-02-10")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  test("Dec → Jan rolls the year exactly once", () => {
    expect(monthsBetween("2026-12-01", "2027-01-01")).toEqual(["2026-12", "2027-01"]);
  });

  test("a within-week cross-month range yields both months", () => {
    // The W27 cross-month window: Jun 29 .. Jul 5 touches June and July.
    expect(monthsBetween("2026-06-29", "2026-07-05")).toEqual(["2026-06", "2026-07"]);
  });
});

describe("addDays", () => {
  test("rolls across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-06-29", 6)).toBe("2026-07-05"); // Monday → Sunday across the month seam
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  test("negative deltas land on the correct (leap-aware) day", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28"); // 2026 not leap
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29"); // 2024 leap
  });

  test("+0 is identity and +7 advances exactly one week's worth", () => {
    expect(addDays("2026-06-29", 0)).toBe("2026-06-29");
    expect(addDays("2026-06-29", 7)).toBe("2026-07-06");
  });
});

describe("monthOf", () => {
  test("extracts the 'YYYY-MM' bucket", () => {
    expect(monthOf("2026-06-29")).toBe("2026-06");
    expect(monthOf("2027-01-03")).toBe("2027-01");
  });
});
