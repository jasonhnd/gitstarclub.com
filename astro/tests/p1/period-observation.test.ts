import { expect, test } from "bun:test";
import { partialPeriodObservationStart } from "../../src/packages/p1/period-observation";
import { observationCases } from "./observation-fixture";

for (const scenario of observationCases) {
  test(scenario.name, () => {
    const currentMonth = { month: scenario.month, daily_totals: scenario.days.map((day) => [day, 0] as [string, number]) };
    expect(partialPeriodObservationStart("month", scenario.month, { currentMonth })).toBe(scenario.expected);
    expect(partialPeriodObservationStart("week", scenario.week, { currentMonth })).toBe(scenario.expected);
  });
}

test("older months use their own heatmap, older weeks without daily observations omit the notice", () => {
  const currentMonth = { month: "2026-08", daily_totals: [["2026-08-01", 10] as [string, number]] };
  expect(partialPeriodObservationStart("month", "2026-07", { currentMonth, heat: { cells: [["2026-07-15", 0], ["2026-07-17", -1]] } })).toBe("2026-07-15");
  expect(partialPeriodObservationStart("month", "2026-07", { currentMonth, heat: { cells: [["2026-07-01", 0], ["2026-07-15", 10]] } })).toBeNull();
  expect(partialPeriodObservationStart("week", "2026-W29", { currentMonth })).toBeNull();
});

test("open months use daily totals even if a conflicting heatmap exists", () => {
  expect(partialPeriodObservationStart("month", "2026-07", {
    currentMonth: { month: "2026-07", daily_totals: [["2026-07-15", 0]] }, heat: { cells: [["2026-07-01", 100]] },
  })).toBe("2026-07-15");
  expect(partialPeriodObservationStart("month", "2026-07", {
    currentMonth: { month: "2026-07", daily_totals: [] }, heat: { cells: [["2026-07-15", 100]] },
  })).toBeNull();
});

test("missing or out-of-period observations do not invent a start date", () => {
  for (const currentMonth of [null, { month: "2026-07", daily_totals: [] }, { month: "2026-08", daily_totals: [["2026-08-10", 1] as [string, number]] }]) {
    expect(partialPeriodObservationStart("week", "2026-W29", { currentMonth })).toBeNull();
    expect(partialPeriodObservationStart("month", "2026-07", { currentMonth })).toBeNull();
  }
});

test("overlapping weeks use only in-period daily dates across month and ISO-year boundaries", () => {
  expect(partialPeriodObservationStart("week", "2026-W27", { currentMonth: { month: "2026-07", daily_totals: [["2026-07-01", 0], ["2026-07-06", 1]] } })).toBe("2026-07-01");
  expect(partialPeriodObservationStart("week", "2026-W53", { currentMonth: { month: "2027-01", daily_totals: [["2027-01-01", 0], ["2027-01-04", 1]] } })).toBe("2027-01-01");
  expect(partialPeriodObservationStart("week", "2026-W01", { currentMonth: { month: "2025-12", daily_totals: [["2025-12-29", 0]] } })).toBeNull();
  expect(partialPeriodObservationStart("week", "2025-W53", { currentMonth: null })).toBeNull();
});
