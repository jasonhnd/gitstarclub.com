// Inflection ("when it broke out") detection — a pure changepoint pass over a repo's monthly
// flow series. Zero new data source, zero LLM: a month is an inflection when its flow both
// (a) exceeds RATIO× the trailing-window median baseline and (b) clears an absolute floor (so a
// ≥10k-star repo's quiet early months don't register). Runs in recompute (entities.ts); the
// result lands in entity/repo/<id>.json and StarCurve marks it.
// See docs/DATA-CONTRACTS.md (RepoEntity.inflections).

export type InflectionKind = "surge" | "peak";
export interface Inflection {
  period: string;
  flow: number;
  kind: InflectionKind;
}

const BASELINE_WINDOW = 6; // trailing months feeding the baseline median
const MIN_BASELINE = 2; // need at least this many prior months before a month can qualify
const RATIO = 3; // flow must be ≥ RATIO × baseline median
const ABS_FLOOR = 500; // …and ≥ this many monthly adds (ignore small-scale noise)
const MAX_MARKS = 3; // cap markers per repo so the curve stays readable

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Breakout months in a [period, flow] series (period-ascending). Returns up to MAX_MARKS by
 *  flow — the single highest is tagged "peak", the rest "surge" — sorted period-ascending. */
export function detectInflections(monthly: ReadonlyArray<readonly [string, number]>): Inflection[] {
  const flows = monthly.map(([, f]) => f);
  const candidates: Array<{ period: string; flow: number }> = [];
  for (let i = MIN_BASELINE; i < monthly.length; i++) {
    const flow = flows[i];
    if (flow < ABS_FLOOR) continue;
    const baseline = median(flows.slice(Math.max(0, i - BASELINE_WINDOW), i));
    if (flow >= RATIO * Math.max(baseline, 1)) candidates.push({ period: monthly[i][0], flow });
  }
  if (candidates.length === 0) return [];

  const top = [...candidates].sort((a, b) => b.flow - a.flow).slice(0, MAX_MARKS);
  const peakPeriod = top[0].period;
  return top
    .map(({ period, flow }): Inflection => ({ period, flow, kind: period === peakPeriod ? "peak" : "surge" }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
}
