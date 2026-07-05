import { describe, expect, test } from "bun:test";
import type { CompareCurve } from "@/lib/contracts";
import { buildCompareConclusionText, buildComparePairConclusion } from "./conclusions";

const curve = (
  fullName: string,
  crossed10k: string | null,
  points: Array<[string, number]>,
  currentStars = points.at(-1)?.[1] ?? 0,
): CompareCurve => ({
  id: fullName.length,
  full_name: fullName,
  crossed_10k: crossed10k,
  points,
  current_stars: currentStars,
});

describe("compare conclusions", () => {
  test("compares growth over the shared 10k-aligned horizon", () => {
    const react = curve("react/react", "2015-05-01", [
      ["2015-05", 10500],
      ["2015-06", 13000],
      ["2015-07", 17000],
      ["2015-08", 22000],
    ]);
    const vue = curve("vuejs/vue", "2016-03-01", [
      ["2016-03", 11000],
      ["2016-04", 14000],
      ["2016-05", 19000],
    ]);

    const conclusion = buildComparePairConclusion({ label: "React vs Vue", a: "react/react", b: "vuejs/vue" }, react, vue);

    expect(conclusion?.horizonMonths).toBe(2);
    expect(conclusion?.winner?.fullName).toBe("vuejs/vue");
    expect(conclusion?.loser?.fullName).toBe("react/react");
    expect(conclusion?.result).toBe("vuejs/vue grew faster after 10k, gaining +8.0k stars in 2 months versus +6.5k for react/react.");
  });

  test("localizes milestone month labels for rendered compare rows", () => {
    const react = curve("react/react", "2015-05-01", [
      ["2015-05", 10500],
      ["2015-06", 13000],
    ]);
    const vue = curve("vuejs/vue", "2016-03-01", [
      ["2016-03", 11000],
      ["2016-04", 14000],
    ]);

    const conclusion = buildComparePairConclusion({ label: "React vs Vue", a: "react/react", b: "vuejs/vue" }, react, vue, "fr");

    expect(conclusion?.repos[0].crossed10kLabel).toBe("mai 2015");
    expect(conclusion?.repos[1].crossed10kLabel).toBe("mars 2016");
  });

  test("omits pairs without a real shared post-10k window", () => {
    const onePoint = curve("a/a", "2020-01-01", [["2020-01", 10000]]);
    const missingMilestone = curve("b/b", null, [["2020-01", 10000], ["2020-02", 12000]]);

    expect(buildComparePairConclusion({ label: "Missing", a: "a/a", b: "b/b" }, onePoint, missingMilestone)).toBeNull();
    expect(buildComparePairConclusion({ label: "Too short", a: "a/a", b: "a/a" }, onePoint, onePoint)).toBeNull();
  });

  test("builds a deterministic server-rendered conclusion sentence", () => {
    const a = curve("a/a", "2020-01-01", [["2020-01", 10000], ["2020-02", 13000]]);
    const b = curve("b/b", "2021-01-01", [["2021-01", 10000], ["2021-02", 12000]]);
    const pair = buildComparePairConclusion({ label: "A vs B", a: "a/a", b: "b/b" }, a, b);

    expect(pair).not.toBeNull();
    expect(buildCompareConclusionText("June 24, 2026", pair ? [pair] : [])).toBe(
      "As of June 24, 2026, a/a grew faster after 10k, gaining +3.0k stars in 1 month versus +2.0k for b/b. GitStarClub computes the table server-side from precomputed Blob repo-curve JSON; client-selected query pairs remain interactive only.",
    );
    expect(buildCompareConclusionText("June 24, 2026", [])).toBeNull();
  });
});
