import { describe, expect, test } from "bun:test";
import { detectInflections } from "./inflections";

const months = (flows: number[], start = 1): Array<[string, number]> =>
  flows.map((f, i) => [`2020-${String(start + i).padStart(2, "0")}`, f] as [string, number]);

describe("detectInflections", () => {
  test("flat / steady series → no inflection (ratio never clears)", () => {
    expect(detectInflections(months([3000, 3000, 3000, 3000, 3000]))).toEqual([]);
  });

  test("short series (< MIN_BASELINE+1) → no inflection", () => {
    expect(detectInflections(months([5000, 9000]))).toEqual([]);
  });

  test("a clear breakout month is flagged as peak", () => {
    // 100,100,100 baseline → 3000 is 30× → surge; only one → peak
    const got = detectInflections(months([100, 100, 100, 3000]));
    expect(got).toEqual([{ period: "2020-04", flow: 3000, kind: "peak" }]);
  });

  test("absolute floor filters small-scale jumps even at high ratio", () => {
    // 10→10→10→400: ratio 40× but 400 < ABS_FLOOR(500) → ignored
    expect(detectInflections(months([10, 10, 10, 400]))).toEqual([]);
  });

  test("ratio gate filters a big-but-proportional month", () => {
    // baseline 4000 → 8000 is only 2× (< RATIO 3) → not an inflection
    expect(detectInflections(months([4000, 4000, 4000, 8000]))).toEqual([]);
  });

  test("caps at 3 marks (top by flow) and tags the single highest as peak, output period-asc", () => {
    // surges at months 4..7 with rising flow; only top 3 kept, period-ascending
    const got = detectInflections(months([100, 100, 100, 1000, 2000, 3000, 4000]));
    expect(got.map((i) => i.period)).toEqual(["2020-05", "2020-06", "2020-07"]);
    expect(got.filter((i) => i.kind === "peak")).toEqual([{ period: "2020-07", flow: 4000, kind: "peak" }]);
    expect(got.filter((i) => i.kind === "surge").length).toBe(2);
  });

  test("negative/zero months (post-seam net) never qualify", () => {
    expect(detectInflections(months([2000, 2000, -500, 0, 100]))).toEqual([]);
  });
});
