import { describe, expect, test } from "bun:test";
import { exactRepoMilestones } from "./repo-milestones";

describe("exactRepoMilestones", () => {
  const series = ["2024-01", "2024-02", "2024-03", "2024-04"].map((label) => ({ label }));

  test("uses frozen first-crossing dates for exact 10k/50k/100k milestones", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2024-02-17",
        crossed_50k: "2024-03-05",
        crossed_100k: "2024-04-29",
      }),
    ).toEqual([
      { stars: 10_000, label: "10k", date: "2024-02-17", monthIndex: 1 },
      { stars: 50_000, label: "50k", date: "2024-03-05", monthIndex: 2 },
      { stars: 100_000, label: "100k", date: "2024-04-29", monthIndex: 3 },
    ]);
  });

  test("does not synthesize higher thresholds from the monthly curve", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2024-02-17",
        crossed_50k: null,
        crossed_100k: null,
      }),
    ).toEqual([{ stars: 10_000, label: "10k", date: "2024-02-17", monthIndex: 1 }]);
  });

  test("hides frozen milestones outside the rendered curve range", () => {
    expect(
      exactRepoMilestones(series, {
        crossed_10k: "2023-12-31",
        crossed_50k: "2024-03-05",
        crossed_100k: null,
      }),
    ).toEqual([{ stars: 50_000, label: "50k", date: "2024-03-05", monthIndex: 2 }]);
  });
});
