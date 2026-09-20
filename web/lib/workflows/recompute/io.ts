import {
  CategoryAssignmentsDocument,
  CategoryAssignmentsShard,
  OrgEntity,
  RepoEntity,
} from "@/lib/contracts";
import { mapLimit } from "@/lib/data/map-limit";
import { readAuthoritativeView, readRequiredView } from "@/lib/data/source";
import { isCloudflareWorkersHost } from "@/lib/runtime-config";
import { assertPublishedViewJsonSize } from "@/lib/view-size";
import {
  CanonicalMeta,
  ReposShard,
  RepoMonthlyShard,
  RepoWeeklyShard,
  RepoRecentDailyShard,
  SiteDaily,
} from "@/lib/contracts";
import { getWriteObjectStore } from "@/lib/storage";
import { canonicalShardReadConcurrency } from "@/lib/workflows/canonical-validation";
import { REPO_BUCKETS } from "../buckets";
import { buildModel, type Model, type RawShards } from "./model";
import { workflowHeartbeat } from "@/lib/workflows/owned-write";
import type { WorkflowOwnership } from "@/lib/workflows/lease";

// Blob I/O for the recompute steps: load the canonical/v2 model and write a versioned
// view set (views/<run_id>/**). Reads bust Blob's short cache with the run id so a step
// sees the canonical shards written earlier in the same run. See VERCEL-DATA-OPERATIONS §3/§7.

const WRITE_PER_SEC = 60; // Blob write-rate budget (OPS §Blob)
const WRITE_CONCURRENCY = 12;
/** Tighter write pool on OpenNext — each Blob PUT also does an ASSETS cache GET. */
export const WRITE_CONCURRENCY_CF = 4;
const SITE_YEAR_MIN = 2010;

export function canonicalModelLoadPlan(env?: Parameters<typeof isCloudflareWorkersHost>[0]): {
  shardConcurrency: number;
  parallelFamilies: boolean;
  writeConcurrency: number;
} {
  const cf = isCloudflareWorkersHost(env);
  return {
    shardConcurrency: canonicalShardReadConcurrency(env),
    parallelFamilies: !cf,
    writeConcurrency: cf ? WRITE_CONCURRENCY_CF : WRITE_CONCURRENCY,
  };
}

async function mergeBuckets<T extends Record<string, unknown>>(
  kind: string,
  schema: Parameters<typeof readAuthoritativeView<T>>[1],
  bust: string,
  shardConcurrency: number,
): Promise<Record<string, T[string]>> {
  const shards = await mapLimit(
    Array.from({ length: REPO_BUCKETS }, (_, bucket) => bucket),
    shardConcurrency,
    async (bucket) => {
      const path = `canonical/v2/${kind}/${bucket}.json`;
      try {
        return await readAuthoritativeView(path, schema, { bust });
      } catch (error) {
        throw new Error(`${path}: schema/read failure — ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    },
  );
  return mergeCompleteBucketShards(kind, shards);
}

export function mergeCompleteBucketShards<T extends Record<string, unknown>>(
  kind: string,
  shards: Array<T | null>,
): Record<string, T[string]> {
  const missing = shards.flatMap((shard, bucket) => (shard === null ? [bucket] : []));
  if (missing.length > 0) {
    throw new Error(`canonical/v2/${kind}: missing required shard(s) ${missing.join(",")}`);
  }
  const out: Record<string, unknown> = {};
  for (const shard of shards) Object.assign(out, shard);
  return out as Record<string, T[string]>;
}

export interface LoadedModel {
  model: Model;
  seamDate: string;
  foldedThrough: { month: string; week: string };
}

/** Load the full canonical/v2 model from Blob (repos + monthly + weekly + recent + site-daily). */
export async function loadCanonicalModel(bust: string): Promise<LoadedModel> {
  const meta = await readRequiredView("canonical/v2/meta.json", CanonicalMeta, { bust });
  const plan = canonicalModelLoadPlan();

  const thisYear = new Date().getUTCFullYear() + 1;
  const years = Array.from({ length: thisYear - SITE_YEAR_MIN + 1 }, (_, i) => String(SITE_YEAR_MIN + i));
  const readSiteYear = (year: string) => readAuthoritativeView(`canonical/v2/site-daily/${year}.json`, SiteDaily, { bust });

  // CF: sequential families + mapLimit(2). The old Promise.all of 4×32 shards
  // is the same 128-way fan-out that 1102'd preflight. Vercel still overlaps families.
  let repos: Record<string, unknown>;
  let monthly: Record<string, unknown>;
  let weekly: Record<string, unknown>;
  let recentDaily: Record<string, unknown>;
  let siteShards: Array<SiteDaily | null>;
  if (plan.parallelFamilies) {
    [repos, monthly, weekly, recentDaily, siteShards] = await Promise.all([
      mergeBuckets("repos", ReposShard, bust, plan.shardConcurrency),
      mergeBuckets("repo-monthly", RepoMonthlyShard, bust, plan.shardConcurrency),
      mergeBuckets("repo-weekly", RepoWeeklyShard, bust, plan.shardConcurrency),
      mergeBuckets("repo-recent-daily", RepoRecentDailyShard, bust, plan.shardConcurrency),
      mapLimit(years, plan.shardConcurrency, readSiteYear),
    ]);
  } else {
    repos = await mergeBuckets("repos", ReposShard, bust, plan.shardConcurrency);
    monthly = await mergeBuckets("repo-monthly", RepoMonthlyShard, bust, plan.shardConcurrency);
    weekly = await mergeBuckets("repo-weekly", RepoWeeklyShard, bust, plan.shardConcurrency);
    recentDaily = await mergeBuckets("repo-recent-daily", RepoRecentDailyShard, bust, plan.shardConcurrency);
    siteShards = await mapLimit(years, plan.shardConcurrency, readSiteYear);
  }

  const siteDailyByYear: RawShards["siteDailyByYear"] = {};
  for (const s of siteShards) if (s) siteDailyByYear[s.year] = s;

  const raw = { repos, monthly, weekly, recentDaily, siteDailyByYear } as unknown as RawShards;
  return { model: buildModel(raw, meta.seam_date), seamDate: meta.seam_date, foldedThrough: meta.folded_through };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Write a view map under views/<run_id>/** with a concurrency pool + write-rate gate. */
export async function writeVersion(runId: string, views: Map<string, unknown>, owner?: WorkflowOwnership): Promise<number> {
  const store = getWriteObjectStore();
  const items = [...views.entries()];
  let i = 0;
  let nextStart = 0;
  const heartbeat = owner ? workflowHeartbeat(owner) : async () => {};
  const gate = async () => {
    const now = Date.now();
    const wait = Math.max(0, nextStart - now);
    nextStart = Math.max(now, nextStart) + 1000 / WRITE_PER_SEC;
    if (wait > 0) await sleep(wait);
  };
  async function worker() {
    while (i < items.length) {
      const [rel, obj] = items[i++];
      await heartbeat();
      await gate();
      assertGeneratedView(rel, obj);
      const payload = JSON.stringify(obj);
      assertPublishedViewJsonSize(rel, payload);
      await store.put(`views/${runId}/${rel}`, payload, {
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 31536000, // versioned path is immutable → cache hard
      });
    }
  }
  await Promise.all(Array.from({ length: canonicalModelLoadPlan().writeConcurrency }, worker));
  return items.length;
}

function assertGeneratedView(rel: string, obj: unknown): void {
  const schema = rel.startsWith("entity/repo/")
    ? RepoEntity
    : rel.startsWith("entity/org/")
      ? OrgEntity
      : rel === "categories/assignments.json"
        ? CategoryAssignmentsDocument
        : /^categories\/assignments\/shards\/\d+\.json$/.test(rel)
          ? CategoryAssignmentsShard
          : null;
  if (!schema) return;
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    throw new Error(`${rel}: schema — ${parsed.error.message}`);
  }
}
