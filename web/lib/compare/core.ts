import type { CompareCurve } from "@/lib/contracts";
import { MAX_COMPARE } from "./constants";

// Pure core for the multi-repo compare page (v0.2 §5): URL repos param parse/serialize, color
// assignment, and the normalization that turns N CompareCurve payloads into a single CompareChart
// the CompareCurve component renders. Two modes: "absolute" overlays on a shared calendar
// timeline, "align10k" re-bases each repo's x-axis to months-since-crossing-10k. No I/O, no
// React — unit-testable under bun.

export { MAX_COMPARE, MIN_COMPARE } from "./constants";

export type CompareMode = "absolute" | "align10k";

/** Categorical chart palette. CSS vars defined in globals.css so the component never hard-codes
 *  hex (DESIGN-SYSTEM rule) and both light/dark themes pick the appropriate hue. */
const COLOR_VARS = ["--chart-cat-1", "--chart-cat-2", "--chart-cat-3", "--chart-cat-4", "--chart-cat-5"] as const;

export function colorVar(i: number): string {
  return COLOR_VARS[((i % COLOR_VARS.length) + COLOR_VARS.length) % COLOR_VARS.length];
}

/** Parse the `?repos=` query value into an ordered, de-duped (case-insensitive), capped list of
 *  `owner/name`. Drops empties and entries without a slash; preserves user-supplied casing. */
export function parseRepos(param: string | null | undefined): string[] {
  if (!param) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of param.split(",")) {
    const name = raw.trim();
    if (!name || !name.includes("/")) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_COMPARE) break;
  }
  return out;
}

export function serializeRepos(names: readonly string[]): string {
  return names.join(",");
}

export interface ComparePoint {
  x: number;
  y: number;
}

export interface CompareLine {
  full_name: string;
  current_stars: number;
  colorVar: string;
  points: ComparePoint[];
}

export interface CompareChart {
  mode: CompareMode;
  lines: CompareLine[];
  xMax: number;
  yMax: number;
  xTicks: Array<{ x: number; label: string }>;
}

/** For align10k: first index in the repo's monthly points whose period is at or after the
 *  crossed_10k month. Falls back to 0 when crossed_10k is null or not found in the series. */
function alignOrigin(curve: CompareCurve): number {
  const cm = curve.crossed_10k ? curve.crossed_10k.slice(0, 7) : null;
  if (cm) {
    const idx = curve.points.findIndex(([p]) => p >= cm);
    if (idx >= 0) return idx;
  }
  return 0;
}

export function buildChart(curves: readonly CompareCurve[], mode: CompareMode): CompareChart {
  const lines: CompareLine[] = [];
  let xMax = 0;
  let yMax = 1;

  if (mode === "align10k") {
    curves.forEach((c, i) => {
      const origin = alignOrigin(c);
      const points: ComparePoint[] = [];
      for (let j = origin; j < c.points.length; j++) {
        const total = c.points[j][1];
        const x = j - origin;
        points.push({ x, y: total });
        if (x > xMax) xMax = x;
        if (total > yMax) yMax = total;
      }
      lines.push({ full_name: c.full_name, current_stars: c.current_stars, colorVar: colorVar(i), points });
    });
    const xTicks: Array<{ x: number; label: string }> = [];
    for (let y = 0; y * 12 <= xMax; y++) {
      xTicks.push({ x: y * 12, label: y === 0 ? "10k" : `+${y}y` });
    }
    return { mode, lines, xMax: Math.max(1, xMax), yMax, xTicks };
  }

  // absolute: shared sorted timeline of all periods present in any series.
  const periodSet = new Set<string>();
  for (const c of curves) for (const [p] of c.points) periodSet.add(p);
  const timeline = [...periodSet].sort();
  const index = new Map<string, number>(timeline.map((p, i) => [p, i]));
  curves.forEach((c, i) => {
    const points: ComparePoint[] = [];
    for (const [p, total] of c.points) {
      const x = index.get(p);
      if (x === undefined) continue;
      points.push({ x, y: total });
      if (total > yMax) yMax = total;
    }
    lines.push({ full_name: c.full_name, current_stars: c.current_stars, colorVar: colorVar(i), points });
  });
  xMax = Math.max(1, timeline.length - 1);
  const xTicks = timeline
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.endsWith("-01"))
    .map(({ p, i }) => ({ x: i, label: p.slice(0, 4) }));
  return { mode, lines, xMax, yMax, xTicks };
}
