// Heatmaps — pure-JS equivalent of precompute's exportHeatmaps. Daily site totals →
// month files; monthly totals → year files. Source = canonical/v2/site-daily shards.

import type { DailySeries } from "./model";

export interface Heatmap {
  meta: { scope: string; period: string; generated_at: string };
  cells: Array<[string, number]>;
}

export function heatmaps(siteDaily: DailySeries, gen: string): Map<string, Heatmap> {
  const out = new Map<string, Heatmap>();
  const byMonth = new Map<string, Array<[string, number]>>();
  for (const [d, tot] of siteDaily) {
    const mo = d.slice(0, 7);
    let cells = byMonth.get(mo);
    if (!cells) byMonth.set(mo, (cells = []));
    cells.push([d, tot]);
  }
  const monthTotals = new Map<string, number>();
  for (const [mo, cells] of byMonth) {
    out.set(`heatmap/month/${mo}.json`, { meta: { scope: "month", period: mo, generated_at: gen }, cells });
    monthTotals.set(mo, cells.reduce((s, c) => s + c[1], 0));
  }
  const byYear = new Map<string, Array<[string, number]>>();
  for (const [mo, tot] of monthTotals) {
    const yr = mo.slice(0, 4);
    let cells = byYear.get(yr);
    if (!cells) byYear.set(yr, (cells = []));
    cells.push([mo, tot]);
  }
  for (const [yr, cells] of byYear) {
    cells.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    out.set(`heatmap/year/${yr}.json`, { meta: { scope: "year", period: yr, generated_at: gen }, cells });
  }
  return out;
}
