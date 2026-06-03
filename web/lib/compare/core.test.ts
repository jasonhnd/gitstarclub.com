import { describe, expect, test } from "bun:test";
import type { CompareCurve } from "@/lib/contracts";
import { MAX_COMPARE, MIN_COMPARE, buildChart, colorVar, parseRepos, serializeRepos } from "./core";

const mk = (full_name: string, points: Array<[string, number]>, crossed_10k: string | null, current_stars = 100000): CompareCurve => ({
  id: full_name.length,
  full_name,
  current_stars,
  crossed_10k,
  points,
});

describe("parseRepos", () => {
  test("splits comma-separated owner/name", () => {
    expect(parseRepos("a/b,c/d")).toEqual(["a/b", "c/d"]);
  });
  test("trims whitespace and drops empties", () => {
    expect(parseRepos("  a/b , , c/d  ")).toEqual(["a/b", "c/d"]);
  });
  test("dedupes case-insensitively, preserves first casing", () => {
    expect(parseRepos("A/B,a/b,C/D")).toEqual(["A/B", "C/D"]);
  });
  test("drops entries without a slash", () => {
    expect(parseRepos("a/b,not-a-repo,c/d")).toEqual(["a/b", "c/d"]);
  });
  test("caps at MAX_COMPARE", () => {
    const many = parseRepos("a/1,a/2,a/3,a/4,a/5,a/6,a/7");
    expect(many).toHaveLength(MAX_COMPARE);
    expect(many[MAX_COMPARE - 1]).toBe(`a/${MAX_COMPARE}`);
  });
  test("returns [] on null/empty", () => {
    expect(parseRepos(null)).toEqual([]);
    expect(parseRepos("")).toEqual([]);
    expect(parseRepos(undefined)).toEqual([]);
  });
});

describe("serializeRepos", () => {
  test("round-trips with parseRepos", () => {
    const names = ["a/b", "c/d", "e/f"];
    expect(parseRepos(serializeRepos(names))).toEqual(names);
  });
  test("guards: MIN_COMPARE is 2", () => {
    expect(MIN_COMPARE).toBe(2);
  });
});

describe("colorVar", () => {
  test("returns one of the chart-cat tokens", () => {
    expect(colorVar(0)).toBe("--chart-cat-1");
    expect(colorVar(4)).toBe("--chart-cat-5");
  });
  test("cycles past palette size", () => {
    expect(colorVar(5)).toBe(colorVar(0));
    expect(colorVar(11)).toBe(colorVar(1));
  });
  test("negative index normalizes", () => {
    expect(colorVar(-1)).toBe("--chart-cat-5");
  });
});

describe("buildChart — absolute", () => {
  const react = mk("facebook/react", [["2014-01", 9800], ["2014-02", 10400], ["2014-03", 11200]], "2014-02-01", 232000);
  const vue = mk("vuejs/vue", [["2014-02", 5000], ["2014-03", 9000], ["2014-04", 12000]], "2014-04-01", 207000);

  test("shared timeline = sorted union of all periods", () => {
    const chart = buildChart([react, vue], "absolute");
    expect(chart.xMax).toBe(3); // 4 periods → indices 0..3
    expect(chart.lines).toHaveLength(2);
    expect(chart.lines[0].points.map((p) => p.x)).toEqual([0, 1, 2]); // react: 2014-01..03
    expect(chart.lines[1].points.map((p) => p.x)).toEqual([1, 2, 3]); // vue: 2014-02..04
  });

  test("yMax is the max total across all series", () => {
    const chart = buildChart([react, vue], "absolute");
    expect(chart.yMax).toBe(12000);
  });

  test("colors assigned by line index from palette", () => {
    const chart = buildChart([react, vue], "absolute");
    expect(chart.lines[0].colorVar).toBe("--chart-cat-1");
    expect(chart.lines[1].colorVar).toBe("--chart-cat-2");
  });

  test("xTicks at each January with year label", () => {
    const a = mk("a/a", [["2020-01", 10000], ["2020-06", 15000], ["2021-01", 20000]], "2020-01-01");
    const b = mk("b/b", [["2020-12", 12000], ["2021-06", 18000]], "2020-12-01");
    const chart = buildChart([a, b], "absolute");
    expect(chart.xTicks).toEqual([
      { x: 0, label: "2020" }, // 2020-01
      { x: 3, label: "2021" }, // 2021-01 — timeline = [2020-01, 2020-06, 2020-12, 2021-01, 2021-06]
    ]);
  });
});

describe("buildChart — align10k", () => {
  const react = mk("facebook/react", [["2014-01", 9800], ["2014-02", 10400], ["2014-03", 11200]], "2014-02-01", 232000);
  const vue = mk("vuejs/vue", [["2014-02", 5000], ["2014-03", 9000], ["2014-04", 12000]], "2014-04-01", 207000);

  test("each line re-bases to x=0 at its own crossing month", () => {
    const chart = buildChart([react, vue], "align10k");
    // react crossed at 2014-02 → origin idx 1, points from idx 1: [{x:0,y:10400},{x:1,y:11200}]
    expect(chart.lines[0].points).toEqual([{ x: 0, y: 10400 }, { x: 1, y: 11200 }]);
    // vue crossed at 2014-04 → origin idx 2, points from idx 2: [{x:0,y:12000}]
    expect(chart.lines[1].points).toEqual([{ x: 0, y: 12000 }]);
  });

  test("xMax = max months-since-crossing across all series", () => {
    const chart = buildChart([react, vue], "align10k");
    expect(chart.xMax).toBe(1);
  });

  test("first xTick is '10k' at x=0", () => {
    const chart = buildChart([react, vue], "align10k");
    expect(chart.xTicks[0]).toEqual({ x: 0, label: "10k" });
  });

  test("yearly ticks +1y, +2y... for long series", () => {
    const long = mk(
      "a/a",
      Array.from({ length: 36 }, (_, i) => [`20${20 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, 10000 + i * 100] as [string, number]),
      "2020-01-01",
    );
    const chart = buildChart([long], "align10k");
    expect(chart.xTicks.map((t) => t.label)).toEqual(["10k", "+1y", "+2y"]);
    expect(chart.xTicks.map((t) => t.x)).toEqual([0, 12, 24]);
  });

  test("crossed_10k null → origin falls back to first point (no points dropped)", () => {
    const odd = mk("o/o", [["2015-01", 50000], ["2015-02", 51000]], null, 60000);
    const chart = buildChart([odd], "align10k");
    expect(chart.lines[0].points).toEqual([{ x: 0, y: 50000 }, { x: 1, y: 51000 }]);
  });

  test("yMax accounts for all aligned series", () => {
    const chart = buildChart([react, vue], "align10k");
    expect(chart.yMax).toBe(12000);
  });
});
