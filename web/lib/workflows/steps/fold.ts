import { readView } from "@/lib/data/source";
import { putView } from "@/lib/data/write";
import { CanonicalMeta, PendingPeriod, RepoMonthlyShard, SiteDaily } from "@/lib/contracts";
import { repoBucket } from "../buckets";
import { currentUtcPeriods } from "@/lib/periods";

// Step 5 — canonical fold (§8.3 step 2). Folds CLOSED months (those with a frozen pending
// snapshot, after folded_through.month and before the current month) into canonical/v2:
// month flow → repo-monthly, daily totals → site-daily; then advances meta.folded_through.month.
// Folded months are post-seam NET — the seam-aware recompute (windows.ts) adds them on top of
// the anchor without discounting by d. Idempotent: upserts by period, only advances forward, so
// a workflow retry never double-counts. Weeks are NOT folded here — they stay on the live overlay
// (read path §4.1, top-20). Runs after metadata, before recompute, so the recompute includes them.

function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return mo >= 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

export async function foldCanonical(runId: string): Promise<{ folded: string[] }> {
  "use step";
  const meta = await readView("canonical/v2/meta.json", CanonicalMeta, { bust: runId });
  if (!meta) throw new Error("canonical/v2/meta.json missing");

  const currentMonth = currentUtcPeriods().monthPeriod;
  const folded: string[] = [];
  let foldedThroughMonth = meta.folded_through.month;

  for (let m = nextMonth(foldedThroughMonth); m < currentMonth; m = nextMonth(m)) {
    const pending = await readView(`canonical/v2/pending/${m}.json`, PendingPeriod, { bust: runId });
    if (!pending) break; // keep the watermark contiguous — stop at the first un-frozen month
    await foldMonth(m, pending, runId);
    foldedThroughMonth = m;
    folded.push(m);
  }

  if (folded.length) {
    await putView("canonical/v2/meta.json", {
      seam_date: meta.seam_date,
      schema_ver: meta.schema_ver,
      folded_through: { month: foldedThroughMonth, week: meta.folded_through.week },
      generated_at: new Date().toISOString(),
    });
  }
  return { folded };
}

async function foldMonth(month: string, pending: PendingPeriod, runId: string): Promise<void> {
  // month flow per repo = Σ daily deltas in the frozen pending snapshot, grouped by bucket.
  const byBucket = new Map<number, Array<[number, number]>>();
  for (const [idStr, series] of Object.entries(pending.per_repo)) {
    let flow = 0;
    for (const [, delta] of series) flow += delta;
    if (flow === 0) continue;
    const id = Number(idStr);
    const b = repoBucket(id);
    let arr = byBucket.get(b);
    if (!arr) byBucket.set(b, (arr = []));
    arr.push([id, flow]);
  }

  for (const [b, entries] of byBucket) {
    const shard = (await readView(`canonical/v2/repo-monthly/${b}.json`, RepoMonthlyShard, { bust: runId })) ?? {};
    for (const [id, flow] of entries) {
      const series = (shard[String(id)] ?? []).filter(([p]) => p !== month); // upsert → idempotent
      series.push([month, flow]);
      series.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
      shard[String(id)] = series;
    }
    await putView(`canonical/v2/repo-monthly/${b}.json`, shard);
  }

  // append the month's daily site totals to site-daily/<year> (heatmap source), upsert by date.
  const year = month.slice(0, 4);
  const site = (await readView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust: runId })) ?? { year, cells: [] };
  const cells = new Map<string, number>(site.cells.map(([d, t]) => [d, t]));
  for (const [date, total] of pending.daily_totals) cells.set(date, total);
  await putView(`canonical/v2/site-daily/${year}.json`, {
    year,
    cells: [...cells.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)),
  });
}
