import { put } from "@vercel/blob";
import { readView } from "@/lib/data/source";
import {
  CanonicalMeta,
  ReposShard,
  RepoMonthlyShard,
  RepoWeeklyShard,
  RepoRecentDailyShard,
  SiteDaily,
} from "@/lib/contracts";
import { requireBlobWriteToken } from "@/lib/runtime-config";
import { REPO_BUCKETS } from "../buckets";
import { buildModel, type Model, type RawShards } from "./model";

// Blob I/O for the recompute steps: load the canonical/v2 model and write a versioned
// view set (views/<run_id>/**). Reads bust Blob's short cache with the run id so a step
// sees the canonical shards written earlier in the same run. See VERCEL-DATA-OPERATIONS §3/§7.

const WRITE_PER_SEC = 60; // Blob write-rate budget (OPS §Blob)
const WRITE_CONCURRENCY = 12;
const SITE_YEAR_MIN = 2010;

async function mergeBuckets<T extends Record<string, unknown>>(
  kind: string,
  schema: Parameters<typeof readView<T>>[1],
  bust: string,
): Promise<Record<string, T[string]>> {
  const shards = await Promise.all(
    Array.from({ length: REPO_BUCKETS }, (_, b) => readView(`canonical/v2/${kind}/${b}.json`, schema, { bust })),
  );
  const out: Record<string, unknown> = {};
  for (const shard of shards) if (shard) Object.assign(out, shard);
  return out as Record<string, T[string]>;
}

export interface LoadedModel {
  model: Model;
  seamDate: string;
  foldedThrough: { month: string; week: string };
}

/** Load the full canonical/v2 model from Blob (repos + monthly + weekly + recent + site-daily). */
export async function loadCanonicalModel(bust: string): Promise<LoadedModel> {
  const meta = await readView("canonical/v2/meta.json", CanonicalMeta, { bust });
  if (!meta) throw new Error("canonical/v2/meta.json not found");

  const thisYear = new Date().getUTCFullYear() + 1;
  const years = Array.from({ length: thisYear - SITE_YEAR_MIN + 1 }, (_, i) => String(SITE_YEAR_MIN + i));
  const [repos, monthly, weekly, recentDaily, siteShards] = await Promise.all([
    mergeBuckets("repos", ReposShard, bust),
    mergeBuckets("repo-monthly", RepoMonthlyShard, bust),
    mergeBuckets("repo-weekly", RepoWeeklyShard, bust),
    mergeBuckets("repo-recent-daily", RepoRecentDailyShard, bust),
    Promise.all(years.map((y) => readView(`canonical/v2/site-daily/${y}.json`, SiteDaily, { bust }))),
  ]);

  const siteDailyByYear: RawShards["siteDailyByYear"] = {};
  for (const s of siteShards) if (s) siteDailyByYear[s.year] = s;

  const raw = { repos, monthly, weekly, recentDaily, siteDailyByYear } as unknown as RawShards;
  return { model: buildModel(raw, meta.seam_date), seamDate: meta.seam_date, foldedThrough: meta.folded_through };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write a view map under views/<run_id>/** with a concurrency pool + write-rate gate. */
export async function writeVersion(runId: string, views: Map<string, unknown>): Promise<number> {
  const token = requireBlobWriteToken();
  const items = [...views.entries()];
  let i = 0;
  let nextStart = 0;
  const gate = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + 1000 / WRITE_PER_SEC;
    if (wait > 0) await sleep(wait);
  };
  async function worker() {
    while (i < items.length) {
      const [rel, obj] = items[i++];
      await gate();
      await put(`views/${runId}/${rel}`, JSON.stringify(obj), {
        access: "public",
        token,
        allowOverwrite: true,
        addRandomSuffix: false,
        contentType: "application/json",
        cacheControlMaxAge: 31536000, // versioned path is immutable → cache hard
      });
    }
  }
  await Promise.all(Array.from({ length: WRITE_CONCURRENCY }, worker));
  return items.length;
}
