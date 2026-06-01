import { revalidatePath } from "next/cache";
import { getReposLookup, getHotSnapshot, getCurrentMonth, getRank } from "@/lib/data";
import { fetchStarCounts, type RepoRef } from "@/lib/github";
import { putView } from "@/lib/data/write";
import { currentUtcPeriods } from "@/lib/periods";

// Daily freshness job (OPS §Cron). JSON-only — no Parquet/engine. Polls current_stars,
// updates the current_month live tail, recomputes the live parts of hot-snapshot
// (all-time by fresh stars + current-month flow), preserves history (year_spine,
// on_this_day, current_year — those are recomputed offline/weekly), then revalidates.
// Idempotent: re-running upserts today's UTC entry, never double-counts.

export const dynamic = "force-dynamic";
export const maxDuration = 800;

const TOP_N = 20;
type Item = { rank: number; id?: number; login?: string; value: number; prev_rank: null };

function upsert(series: [string, number][], date: string, value: number): [string, number][] {
  return [...series.filter(([d]) => d !== date), [date, value]];
}

function topByValue(pairs: { id?: number; login?: string; value: number }[]): Item[] {
  return [...pairs]
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N)
    .map((p, i) => ({ rank: i + 1, ...(p.id != null ? { id: p.id } : { login: p.login }), value: p.value, prev_rank: null }));
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response("Unauthorized", { status: 401 });

  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const lookup = await getReposLookup();
  if (!lookup) return Response.json({ error: "lookup unavailable" }, { status: 500 });

  const refs: RepoRef[] = Object.entries(lookup).map(([id, e]) => ({ id: Number(id), owner: e.owner, name: e.name }));
  const fresh = await fetchStarCounts(dry ? refs.slice(0, 50) : refs);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const [existingCM, snap, monthRank] = await Promise.all([
    getCurrentMonth(),
    getHotSnapshot(),
    getRank("month", month, "repo", "flow"), // backfilled current-month base (seam: canonical 1..seam)
  ]);

  // baseline = last known per-repo total (cross-month); delta = fresh − baseline
  const prevStars = (id: number) => existingCM?.current_stars?.[String(id)] ?? lookup[String(id)].current_stars;
  const mergedStars = new Map<number, number>(refs.map((r) => [r.id, lookup[String(r.id)].current_stars]));
  if (existingCM) for (const [id, s] of Object.entries(existingCM.current_stars)) mergedStars.set(Number(id), s);
  for (const [id, s] of fresh) mergedStars.set(id, s);

  // today's per-repo net delta (only for successfully polled repos)
  const carryMonth = existingCM?.month === month ? existingCM : undefined;
  const perRepo: Record<string, [string, number][]> = {};
  if (carryMonth) for (const [id, arr] of Object.entries(carryMonth.per_repo)) perRepo[id] = arr.filter(([d]) => d !== today);
  let dayTotal = 0;
  for (const [id, stars] of fresh) {
    const delta = stars - prevStars(id);
    dayTotal += delta;
    if (delta !== 0) perRepo[String(id)] = upsert(perRepo[String(id)] ?? [], today, delta);
  }
  const dailyTotals = upsert(carryMonth?.daily_totals ?? [], today, dayTotal);

  // recompute live parts of hot-snapshot
  const allRepo = topByValue([...mergedStars].map(([id, value]) => ({ id, value })));
  const orgSum = new Map<string, number>();
  for (const [id, value] of mergedStars) {
    const owner = lookup[String(id)]?.owner;
    if (owner) orgSum.set(owner, (orgSum.get(owner) ?? 0) + value);
  }
  const allOrg = topByValue([...orgSum].map(([login, value]) => ({ login, value })));
  // current-month flow = backfilled base (canonical days) + live-tail deltas (post-seam days)
  const baseFlow = new Map<number, number>();
  if (monthRank) for (const it of monthRank.items) if (it.id != null) baseFlow.set(it.id, it.value);
  for (const [id, arr] of Object.entries(perRepo)) {
    const k = Number(id);
    baseFlow.set(k, (baseFlow.get(k) ?? 0) + arr.reduce((s, [, v]) => s + v, 0));
  }
  const monthFlow = [...baseFlow].map(([id, value]) => ({ id, value }));
  const currentMonthTop = { flow: topByValue(monthFlow), stock: topByValue([...mergedStars].map(([id, value]) => ({ id, value }))) };

  const result = {
    day: today,
    month,
    polled: fresh.size,
    day_total: dayTotal,
    all_time_repo_1: allRepo[0],
    current_month_flow_1: currentMonthTop.flow[0] ?? null,
  };
  if (dry) return Response.json({ dry: true, ...result });

  const currentMonth = {
    month,
    updated: today,
    daily_totals: dailyTotals,
    per_repo: perRepo,
    current_stars: Object.fromEntries(mergedStars),
  };
  const hotSnapshot = {
    generated_at: now.toISOString(),
    home: {
      year_spine: snap?.home.year_spine ?? [],
      current_month_top: currentMonthTop,
      on_this_day: snap?.home.on_this_day ?? [],
    },
    current_year: snap?.current_year ?? currentMonthTop,
    current_month: currentMonthTop,
    all_time: { repo: allRepo, org: allOrg },
  };

  await Promise.all([putView("current_month.json", currentMonth), putView("hot-snapshot.json", hotSnapshot)]);

  const y = month.slice(0, 4);
  const periods = currentUtcPeriods(now);
  const suffixes = [
    "",
    "/pulse",
    "/rankings",
    `/rankings/${y}`,
    `/rankings/${y}/${Number(month.slice(5, 7))}`,
    `/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`,
  ];
  for (const s of suffixes) revalidatePath(s || "/");

  return Response.json({ ok: true, ...result });
}
