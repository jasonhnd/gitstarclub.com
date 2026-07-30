// Backfill a missing live week rank from GH Archive WatchEvents.
//
// 2026-W27 recovery after GITHUB_TOKEN outage (no pending/live daily rows).
// GROSS WatchEvent counts for tracked repos; top-20 flow matching live cron.
//
// Full week:
//   bun run scripts/backfill-live-week.ts --week 2026-W27
// One day (writes partial state under /tmp, merge with --finalize):
//   bun run scripts/backfill-live-week.ts --week 2026-W27 --date 2026-06-29
//   bun run scripts/backfill-live-week.ts --week 2026-W27 --finalize

import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { put } from "@vercel/blob";
import { RankList } from "../lib/contracts";
import { requireBlobWriteToken } from "../lib/runtime-config";
import { loadWebEnvFiles, warnEnvFileDiagnostic } from "./lib/env";
import { fileURLToPath } from "node:url";

const TOP_N = 20;
const HOUR_CONCURRENCY = 3;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const webDir = fileURLToPath(new URL("..", import.meta.url));

type Args = { week: string; dry: boolean; date: string | null; finalize: boolean };

function parseArgs(argv: string[]): Args {
  let week = "2026-W27";
  let dry = false;
  let date: string | null = null;
  let finalize = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") dry = true;
    else if (a === "--finalize") finalize = true;
    else if (a === "--week") week = argv[++i] ?? "";
    else if (a.startsWith("--week=")) week = a.slice("--week=".length);
    else if (a === "--date") date = argv[++i] ?? "";
    else if (a.startsWith("--date=")) date = a.slice("--date=".length);
    else if (a === "-h" || a === "--help") {
      console.log("Usage: bun run scripts/backfill-live-week.ts [--week YYYY-Www] [--date YYYY-MM-DD] [--finalize] [--dry]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${a}`);
  }
  if (!WEEK_RE.test(week)) throw new Error(`Invalid --week ${week}`);
  if (date && !DATE_RE.test(date)) throw new Error(`Invalid --date ${date}`);
  if (date && finalize) throw new Error("Use either --date or --finalize, not both");
  return { week, dry, date, finalize };
}

export function isoWeekDays(weekId: string): string[] {
  const m = WEEK_RE.exec(weekId);
  if (!m) throw new Error(`bad week id ${weekId}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function topWeekFlowItems(counts: Map<number, number>, topN = TOP_N): RankList["items"] {
  return [...counts.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, topN)
    .map(([id, value], index) => ({ rank: index + 1, id, value, prev_rank: null }));
}

function stateDir(week: string): string {
  const dir = join(tmpdir(), `gitstarclub-backfill-${week}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function dayStatePath(week: string, date: string): string {
  return join(stateDir(week), `${date}.json`);
}

function loadDayCounts(week: string, date: string): Map<number, number> | null {
  const p = dayStatePath(week, date);
  if (!existsSync(p)) return null;
  const obj = JSON.parse(readFileSync(p, "utf8")) as Record<string, number>;
  return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
}

function saveDayCounts(week: string, date: string, counts: Map<number, number>): void {
  const obj = Object.fromEntries([...counts.entries()].map(([k, v]) => [String(k), v]));
  writeFileSync(dayStatePath(week, date), JSON.stringify(obj));
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 30_000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    throw new Error(`${url} -> ${res.status}`);
  }
  return res.json();
}

async function loadTrackedRepoIds(blobBase: string): Promise<Set<number>> {
  const pointer = (await fetchJsonWithTimeout(`${blobBase}/views/latest.json`)) as { version?: string };
  if (!pointer.version) throw new Error("views/latest.json missing version");
  const lookup = (await fetchJsonWithTimeout(
    `${blobBase}/views/${pointer.version}/lookup/repos.json`,
  )) as Record<string, unknown>;
  return new Set(Object.keys(lookup).map(Number).filter((n) => Number.isFinite(n)));
}

async function countWatchEventsInHour(date: string, hour: number, tracked: Set<number>): Promise<Map<number, number>> {
  const url = `https://data.gharchive.org/${date}-${hour}.json.gz`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok || !res.body) {
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const counts = new Map<number, number>();
      // Node/web stream types diverge under tsc; cast via unknown for Readable.fromWeb.
      const nodeStream = Readable.fromWeb(res.body as unknown as import("node:stream/web").ReadableStream);
      const gunzip = createGunzip();
      const rl = createInterface({ input: nodeStream.pipe(gunzip), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line.includes('"WatchEvent"')) continue;
        let ev: { type?: string; repo?: { id?: number } };
        try {
          ev = JSON.parse(line) as { type?: string; repo?: { id?: number } };
        } catch {
          continue;
        }
        if (ev.type !== "WatchEvent") continue;
        const id = ev.repo?.id;
        if (id == null || !tracked.has(id)) continue;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    } catch (err) {
      lastErr = err;
      try {
        await res?.body?.cancel();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`GH Archive ${url} failed: ${lastErr}`);
}

function mergeCounts(into: Map<number, number>, from: Map<number, number>): void {
  for (const [id, n] of from) into.set(id, (into.get(id) ?? 0) + n);
}

async function countDay(date: string, tracked: Set<number>): Promise<Map<number, number>> {
  const day = new Map<number, number>();
  for (let start = 0; start < 24; start += HOUR_CONCURRENCY) {
    const batch = Array.from({ length: Math.min(HOUR_CONCURRENCY, 24 - start) }, (_, k) => start + k);
    const parts = await Promise.all(batch.map((hour) => countWatchEventsInHour(date, hour, tracked)));
    for (const part of parts) mergeCounts(day, part);
    console.log(`    ${date} hours ${start}-${start + batch.length - 1} done (repos=${day.size})`);
  }
  return day;
}

async function publishWeek(week: string, counts: Map<number, number>, blobBase: string, dry: boolean): Promise<{ path: string; items: RankList["items"] }> {
  const items = topWeekFlowItems(counts, TOP_N);
  const payload = RankList.parse({
    meta: {
      window: "week",
      period: week,
      dim: "repo",
      metric: "flow",
      generated_at: new Date().toISOString(),
    },
    items,
  });
  console.log("top10:");
  for (const it of items.slice(0, 10)) console.log(`  #${it.rank} id=${it.id} value=${it.value}`);
  const path = `live/rank/week/${week}/repo/flow.json`;
  if (dry) {
    console.log(`DRY RUN — would put ${path}`);
    return { path, items };
  }
  const token = requireBlobWriteToken();
  await put(path, JSON.stringify(payload), {
    access: "public",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
  console.log(`wrote ${blobBase}/${path}`);
  return { path, items };
}

export async function runBackfillLiveWeek(args: Args): Promise<{ path: string; items: RankList["items"] } | { saved: string }> {
  loadWebEnvFiles(webDir, {
    keys: ["BLOB_BASE_URL", "BLOB_READ_WRITE_TOKEN", "NEXT_PUBLIC_BLOB_BASE_URL"],
    onDiagnostic: warnEnvFileDiagnostic,
  });
  const blobBase = (process.env.BLOB_BASE_URL ?? process.env.NEXT_PUBLIC_BLOB_BASE_URL ?? "").replace(/\/+$/, "");
  if (!blobBase) throw new Error("BLOB_BASE_URL required");

  const days = isoWeekDays(args.week);
  console.log(`backfill ${args.week} days=${days.join(",")} date=${args.date ?? "*"} finalize=${args.finalize} dry=${args.dry}`);

  if (args.finalize) {
    const weekCounts = new Map<number, number>();
    for (const d of days) {
      const part = loadDayCounts(args.week, d);
      if (!part) throw new Error(`missing day state for ${d}; run --date ${d} first`);
      mergeCounts(weekCounts, part);
      console.log(`  loaded ${d} repos=${part.size}`);
    }
    return publishWeek(args.week, weekCounts, blobBase, args.dry);
  }

  const tracked = await loadTrackedRepoIds(blobBase);
  console.log(`tracked repos=${tracked.size}`);

  const targets = args.date ? [args.date] : days;
  for (const d of targets) {
    if (!days.includes(d)) throw new Error(`${d} is not in ${args.week}`);
    const existing = loadDayCounts(args.week, d);
    if (existing) {
      console.log(`  skip ${d} (cached state, repos=${existing.size})`);
      continue;
    }
    console.log(`  day ${d}…`);
    const dayCounts = await countDay(d, tracked);
    saveDayCounts(args.week, d, dayCounts);
    const total = [...dayCounts.values()].reduce((a, b) => a + b, 0);
    console.log(`  saved ${d} stars=${total} repos=${dayCounts.size} -> ${dayStatePath(args.week, d)}`);
  }

  if (args.date) {
    return { saved: dayStatePath(args.week, args.date) };
  }

  // Full week in one run: merge all day states (just written) and publish.
  const weekCounts = new Map<number, number>();
  for (const d of days) {
    const part = loadDayCounts(args.week, d);
    if (!part) throw new Error(`internal: missing ${d} after count`);
    mergeCounts(weekCounts, part);
  }
  return publishWeek(args.week, weekCounts, blobBase, args.dry);
}

if (import.meta.main) {
  runBackfillLiveWeek(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
