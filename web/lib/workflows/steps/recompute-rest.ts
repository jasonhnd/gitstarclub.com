import { z } from "zod";
import { CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsShardPath } from "@/lib/data/category-assignment-shards";
import { clearViewParseMemo } from "@/lib/data/parse-view";
import { readAuthoritativeView } from "@/lib/data/source";
import type { WorkflowOwnership } from "@/lib/workflows/lease";
import { putOwnedView } from "@/lib/workflows/owned-write";
import { REPO_BUCKETS } from "../buckets";
import { categoryAssignmentShardDocument, categoryAssignmentsIndexDocument, categoryViewsFromAggregates } from "../recompute/categories";
import { parseRestCarry, parseRestPartial } from "../recompute/carry-codec";
import { loadFullReposBucket, writeVersionAndClear } from "../recompute/io";
import {
  allTimeViewsFromCarry,
  categoryAggregatesFromPartials,
  emptyRestCarry,
  foldRestBucket,
  newcomerViewsFromCarry,
  orgLookupFromCarry,
  type RestBucketPartial,
  type RestCarry,
} from "../recompute/rest-fold";

// Rest used to loadCanonicalModel every repo into one isolate. Each hop now
// reads one repos bucket, or finalizes one already-bounded product.

export const REST_INGEST_BUCKETS = REPO_BUCKETS;
export const REST_OFFSET_RANKS = REPO_BUCKETS;
export const REST_OFFSET_LOOKUP = REPO_BUCKETS + 1;
export const REST_OFFSET_SEARCH = REPO_BUCKETS + 2;
export const REST_OFFSET_CATEGORIES = REPO_BUCKETS + 3;

export type RestHopResult = {
  files: number;
  nextRecomputePhase?: "rest";
  nextRecomputeOffset?: number;
};

const UnknownJson = z.unknown();

function restCarryPath(runId: string): string {
  return `ops/workflows/${runId}/recompute/rest-carry.json`;
}

function restPartialPath(runId: string, bucket: number): string {
  return `ops/workflows/${runId}/recompute/rest-part/${bucket}.json`;
}

async function readCarry(runId: string): Promise<RestCarry | null> {
  const path = restCarryPath(runId);
  const raw = await readAuthoritativeView(path, UnknownJson, { bust: runId, skipSchemaParse: true });
  // Only an absent object is null. A present but malformed carry must fail loudly.
  return raw === null ? null : parseRestCarry(raw, path);
}

async function readPartial(runId: string, bucket: number): Promise<RestBucketPartial> {
  const path = restPartialPath(runId, bucket);
  const raw = await readAuthoritativeView(path, UnknownJson, { bust: runId, skipSchemaParse: true });
  if (raw === null) throw new Error(`${path}: missing rest partial`);
  return parseRestPartial(raw, path);
}

async function ingestBucket(
  runId: string,
  owner: WorkflowOwnership,
  bucket: number,
  generatedAt: string,
): Promise<RestHopResult> {
  const existing = await readCarry(runId);
  const carry = existing ?? emptyRestCarry(generatedAt);
  if (carry.doneBuckets.includes(bucket)) {
    return { files: 0, nextRecomputePhase: "rest", nextRecomputeOffset: bucket + 1 };
  }
  const repos = await loadFullReposBucket(runId, bucket);
  const partial = foldRestBucket(carry, repos.values());
  repos.clear();
  clearViewParseMemo();
  // The carry is the commit point: doneBuckets is written last, so a failure at
  // any earlier write leaves the bucket undone and the retry redoes all three.
  await putOwnedView(owner, restPartialPath(runId, bucket), partial);
  const views = new Map<string, unknown>([
    [categoryAssignmentsShardPath(bucket), categoryAssignmentShardDocument(bucket, carry.generatedAt, partial.assignments)],
  ]);
  const files = await writeVersionAndClear(runId, views, owner);
  const doneBuckets = [...carry.doneBuckets, bucket].sort((left, right) => left - right);
  await putOwnedView(owner, restCarryPath(runId), { ...carry, doneBuckets });
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: bucket + 1 };
}

async function writeRankViews(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const views = new Map<string, unknown>();
  for (const [path, view] of allTimeViewsFromCarry(carry)) views.set(path, view);
  for (const [path, view] of newcomerViewsFromCarry(carry)) views.set(path, view);
  views.set("lookup/orgs.json", orgLookupFromCarry(carry));
  const files = await writeVersionAndClear(runId, views, owner);
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_LOOKUP };
}

async function writeRepoLookup(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const lookup: RestBucketPartial["lookup"] = {};
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    Object.assign(lookup, partial.lookup);
    clearViewParseMemo();
  }
  const files = await writeVersionAndClear(runId, new Map<string, unknown>([["lookup/repos.json", lookup]]), owner);
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_SEARCH };
}

async function writeSearch(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const repos: RestBucketPartial["search"] = [];
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    repos.push(...partial.search);
    clearViewParseMemo();
  }
  repos.sort((left, right) => left.id - right.id);
  const files = await writeVersionAndClear(
    runId,
    new Map<string, unknown>([["search/index.json", { generated_at: carry.generatedAt, count: repos.length, repos }]]),
    owner,
  );
  return { files, nextRecomputePhase: "rest", nextRecomputeOffset: REST_OFFSET_CATEGORIES };
}

async function writeCategories(runId: string, owner: WorkflowOwnership): Promise<RestHopResult> {
  const carry = await readCarry(runId);
  if (!carry) throw new Error(`${restCarryPath(runId)}: missing rest carry`);
  const counts = new Map<string, number>();
  const languageLabels = new Map<string, string>();
  const members = new Map<string, Array<{ id: number; stars: number }>>();
  for (let bucket = 0; bucket < REPO_BUCKETS; bucket++) {
    const partial = await readPartial(runId, bucket);
    const folded = categoryAggregatesFromPartials([partial]);
    for (const [slug, label] of folded.languageLabels) languageLabels.set(slug, label);
    for (const [category, count] of folded.counts) counts.set(category, (counts.get(category) ?? 0) + count);
    for (const [category, rows] of folded.members) {
      const list = members.get(category) ?? [];
      list.push(...rows);
      members.set(category, list);
    }
    clearViewParseMemo();
  }
  const views = categoryViewsFromAggregates(carry.generatedAt, counts, languageLabels, members);
  views.set(CATEGORY_ASSIGNMENTS_INDEX_PATH, categoryAssignmentsIndexDocument(carry.generatedAt));
  const files = await writeVersionAndClear(runId, views, owner);
  return { files };
}

export async function runRestRankHop(
  runId: string,
  owner: WorkflowOwnership,
  offset: number,
  generatedAt: string,
): Promise<RestHopResult> {
  if (offset < REST_INGEST_BUCKETS) return ingestBucket(runId, owner, offset, generatedAt);
  if (offset === REST_OFFSET_RANKS) return writeRankViews(runId, owner);
  if (offset === REST_OFFSET_LOOKUP) return writeRepoLookup(runId, owner);
  if (offset === REST_OFFSET_SEARCH) return writeSearch(runId, owner);
  if (offset === REST_OFFSET_CATEGORIES) return writeCategories(runId, owner);
  return { files: 0 };
}
