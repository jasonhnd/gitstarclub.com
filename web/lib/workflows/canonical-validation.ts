import type { ZodType } from "zod";
import { mapLimit } from "@/lib/data/map-limit";
import { isCloudflareWorkersHost, isPreviewPreflightEmptyShardRelaxed } from "@/lib/runtime-config";
import { readAuthoritativeView } from "@/lib/data/source";
import {
  CanonicalGenerationManifest,
  RepoMonthlyShard,
  RepoRecentDailyShard,
  ReposShard,
  RepoWeeklyShard,
  type ReposShardEntry,
} from "@/lib/contracts";
import { REPO_BUCKETS, repoBucket } from "./buckets";

export const HIGH_D_FACTOR_WARN_THRESHOLD = 2;

/** Peak parallel canonical shard reads on Vercel. */
export const CANONICAL_SHARD_READ_CONCURRENCY = 4;
/** Tighter cap on OpenNext (`HOSTING_TARGET=cf`) — each Blob GET is a Worker subrequest. */
export const CANONICAL_SHARD_READ_CONCURRENCY_CF = 2;

export function canonicalShardReadConcurrency(
  env?: Parameters<typeof isCloudflareWorkersHost>[0],
): number {
  return isCloudflareWorkersHost(env)
    ? CANONICAL_SHARD_READ_CONCURRENCY_CF
    : CANONICAL_SHARD_READ_CONCURRENCY;
}

const SHARD_SPECS = [
  { kind: "repos", schema: ReposShard },
  { kind: "repo-monthly", schema: RepoMonthlyShard },
  { kind: "repo-weekly", schema: RepoWeeklyShard },
  { kind: "repo-recent-daily", schema: RepoRecentDailyShard },
] as const;

export const EXPECTED_CANONICAL_SHARDS = SHARD_SPECS.length * REPO_BUCKETS;

/** Auditable preview-only policy: missing/empty shards become `{}` placeholders. */
export const PREVIEW_EMPTY_SHARD_POLICY = "preview-empty-canonical-placeholder" as const;
export type CanonicalEmptyShardPolicy = "fail-closed" | typeof PREVIEW_EMPTY_SHARD_POLICY;

export function resolveCanonicalEmptyShardPolicy(
  env?: Parameters<typeof isPreviewPreflightEmptyShardRelaxed>[0],
): CanonicalEmptyShardPolicy {
  return isPreviewPreflightEmptyShardRelaxed(env) ? PREVIEW_EMPTY_SHARD_POLICY : "fail-closed";
}

function isPreviewPlaceholderPolicy(policy: CanonicalEmptyShardPolicy): boolean {
  switch (policy) {
    case "fail-closed":
      return false;
    case PREVIEW_EMPTY_SHARD_POLICY:
      return true;
    default: {
      const _exhaustive: never = policy;
      return _exhaustive;
    }
  }
}

export type CanonicalShardReader = (path: string, schema: ZodType) => Promise<unknown | null>;

export type CanonicalPreflightAcc = {
  repoRecords: number;
  monthlyRecords: number;
  weeklyRecords: number;
  recentDailyRecords: number;
  validatedShards: number;
  schemaFailures: number;
  placeholderShards: number;
};

export interface CanonicalValidationResult {
  manifest: CanonicalGenerationManifest;
  checked: number;
  schemaFailures: number;
  invariants: Record<string, boolean | number>;
  failures: string[];
  placeholders: string[];
  repoIds: Set<string>;
  activeRepoIds: Set<string>;
  acc: CanonicalPreflightAcc;
}

type AnchoringShard = Record<string, Pick<ReposShardEntry, "d" | "tracked_since" | "active">>;

type AnchoringState = {
  reposChecked: number;
  reposWithD: number;
  historicalMissingD: number;
  newcomerDefaultD: number;
  highCount: number;
  maxD: number;
};

function emptyAnchoringState(): AnchoringState {
  return {
    reposChecked: 0,
    reposWithD: 0,
    historicalMissingD: 0,
    newcomerDefaultD: 0,
    highCount: 0,
    maxD: 0,
  };
}

function accumulateAnchoringFactors(
  state: AnchoringState,
  shard: AnchoringShard,
  threshold: number,
): void {
  for (const repo of Object.values(shard)) {
    state.reposChecked++;
    if (typeof repo.d !== "number" || !Number.isFinite(repo.d)) {
      if (repo.tracked_since == null) state.historicalMissingD++;
      else state.newcomerDefaultD++;
      continue;
    }
    state.reposWithD++;
    state.maxD = Math.max(state.maxD, repo.d);
    if (repo.d > threshold) state.highCount++;
  }
}

function anchoringInvariants(state: AnchoringState, threshold: number): Record<string, boolean | number> {
  return {
    d_factor_warn_threshold: threshold,
    d_factor_repos_checked: state.reposChecked,
    d_factor_repos_with_d: state.reposWithD,
    d_factor_historical_missing: state.historicalMissingD,
    d_factor_newcomer_default_zero: state.newcomerDefaultD,
    d_factor_high_count: state.highCount,
    d_factor_max: Math.round(state.maxD * 1000) / 1000,
    d_factor_warning: state.highCount > 0,
  };
}

export function inspectAnchoringFactors(
  shards: AnchoringShard[],
  threshold = HIGH_D_FACTOR_WARN_THRESHOLD,
): Record<string, boolean | number> {
  const state = emptyAnchoringState();
  for (const shard of shards) accumulateAnchoringFactors(state, shard, threshold);
  return anchoringInvariants(state, threshold);
}

export function emptyCanonicalPreflightAcc(): CanonicalPreflightAcc {
  return {
    repoRecords: 0,
    monthlyRecords: 0,
    weeklyRecords: 0,
    recentDailyRecords: 0,
    validatedShards: 0,
    schemaFailures: 0,
    placeholderShards: 0,
  };
}

export function mergeCanonicalPreflightAcc(
  left: CanonicalPreflightAcc,
  right: CanonicalPreflightAcc,
): CanonicalPreflightAcc {
  return {
    repoRecords: left.repoRecords + right.repoRecords,
    monthlyRecords: left.monthlyRecords + right.monthlyRecords,
    weeklyRecords: left.weeklyRecords + right.weeklyRecords,
    recentDailyRecords: left.recentDailyRecords + right.recentDailyRecords,
    validatedShards: left.validatedShards + right.validatedShards,
    schemaFailures: left.schemaFailures + right.schemaFailures,
    placeholderShards: (left.placeholderShards ?? 0) + (right.placeholderShards ?? 0),
  };
}

/** Family-wide emptiness is only meaningful after every bucket window has been counted. */
export function emptySeriesPreflightFailures(
  acc: CanonicalPreflightAcc,
  policy: CanonicalEmptyShardPolicy = "fail-closed",
): string[] {
  if (isPreviewPlaceholderPolicy(policy)) return [];
  const failures: string[] = [];
  if (acc.repoRecords === 0) {
    failures.push("canonical/v2/repos: no repository records");
  }
  if (acc.repoRecords > 0) {
    if (acc.monthlyRecords === 0) {
      failures.push(`canonical/v2/repo-monthly: no repository records for ${acc.repoRecords} canonical repo(s)`);
    }
    if (acc.weeklyRecords === 0) {
      failures.push(`canonical/v2/repo-weekly: no repository records for ${acc.repoRecords} canonical repo(s)`);
    }
    if (acc.recentDailyRecords === 0) {
      failures.push(`canonical/v2/repo-recent-daily: no repository records for ${acc.repoRecords} canonical repo(s)`);
    }
  }
  return failures;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).toSorted().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

async function checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const SKIPPED_CHECKSUM = "0".repeat(64);

export async function validateCanonicalGeneration(
  runId: string,
  options: {
    reader?: CanonicalShardReader;
    generatedAt?: string;
    scope?: "repositories" | "full";
    buckets?: readonly number[];
    concurrency?: number;
    checksum?: boolean;
    finalize?: boolean;
    emptyShardPolicy?: CanonicalEmptyShardPolicy;
  } = {},
): Promise<CanonicalValidationResult> {
  const reader = options.reader ?? ((path, schema) => readAuthoritativeView(path, schema, { bust: runId }));
  const specs = options.scope === "repositories" ? SHARD_SPECS.slice(0, 1) : SHARD_SPECS;
  const buckets = options.buckets ?? Array.from({ length: REPO_BUCKETS }, (_, index) => index);
  const expectedShards = specs.length * buckets.length;
  const checksumEnabled = options.checksum !== false;
  const finalize = options.finalize !== false;
  const emptyShardPolicy = options.emptyShardPolicy ?? resolveCanonicalEmptyShardPolicy();
  const allowPlaceholder = isPreviewPlaceholderPolicy(emptyShardPolicy);
  const concurrency = Math.max(1, options.concurrency ?? canonicalShardReadConcurrency());
  const failures: string[] = [];
  const placeholders: string[] = [];
  const repoIds = new Set<string>();
  const activeRepoIds = new Set<string>();
  const seriesRepoIds = new Map<string, Set<string>>(
    SHARD_SPECS.slice(1).map((spec) => [spec.kind, new Set<string>()]),
  );
  const recordsByKind = new Map<string, number>(SHARD_SPECS.map((spec) => [spec.kind, 0]));
  const anchoring = emptyAnchoringState();
  let historicalRepos = 0;
  let missingTrackingStatus = 0;
  let missingTrackedSinceField = 0;
  let bucketPlacementFailures = 0;
  let repoIdentityFailures = 0;
  let schemaFailures = 0;

  const work = specs.flatMap((spec) => buckets.map((bucket) => ({ spec, bucket })));
  const results = await mapLimit(work, concurrency, async ({ spec, bucket }) => {
    const path = `canonical/v2/${spec.kind}/${bucket}.json`;
    try {
      let value = await reader(path, spec.schema);
      if (value === null) {
        if (!allowPlaceholder) {
          failures.push(`${path}: missing`);
          return null;
        }
        placeholders.push(path);
        value = {};
      }
      const parsed = spec.schema.safeParse(value);
      if (!parsed.success) {
        schemaFailures++;
        failures.push(`${path}: schema — ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`.trim()).join("; ")}`);
        return null;
      }
      const records = Object.keys(parsed.data as Record<string, unknown>).length;
      recordsByKind.set(spec.kind, (recordsByKind.get(spec.kind) ?? 0) + records);
      if (spec.kind === "repos") {
        const shard = parsed.data as Record<string, ReposShardEntry>;
        accumulateAnchoringFactors(anchoring, shard, HIGH_D_FACTOR_WARN_THRESHOLD);
        for (const [id, repo] of Object.entries(shard)) {
          const numericId = Number(id);
          if (!Number.isSafeInteger(numericId) || numericId < 0 || repo.id !== numericId) {
            repoIdentityFailures++;
          } else if (repoBucket(numericId) !== bucket) {
            bucketPlacementFailures++;
          }
          repoIds.add(id);
          if (repo.active === true) activeRepoIds.add(id);
          else if (repo.active === false) historicalRepos++;
          else missingTrackingStatus++;
          if (!("tracked_since" in repo)) missingTrackedSinceField++;
        }
      } else {
        const ids = seriesRepoIds.get(spec.kind)!;
        for (const id of Object.keys(parsed.data as Record<string, unknown>)) {
          ids.add(id);
          const numericId = Number(id);
          if (!Number.isSafeInteger(numericId) || numericId < 0 || repoBucket(numericId) !== bucket) {
            bucketPlacementFailures++;
          }
        }
      }
      return {
        path,
        kind: spec.kind,
        bucket,
        records,
        sha256: checksumEnabled ? await checksum(parsed.data) : SKIPPED_CHECKSUM,
      };
    } catch (error) {
      schemaFailures++;
      failures.push(`${path}: schema/read — ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  });

  placeholders.sort((left, right) => left.localeCompare(right));
  const shards = results.filter((entry): entry is NonNullable<typeof entry> => entry !== null).toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );
  const dInvariants = anchoringInvariants(anchoring, HIGH_D_FACTOR_WARN_THRESHOLD);
  const historicalMissing = Number(dInvariants.d_factor_historical_missing ?? 0);
  if (historicalMissing > 0) {
    failures.push(`canonical/v2/repos: ${historicalMissing} historical repo(s) are missing a finite anchoring factor d`);
  }
  if (missingTrackingStatus > 0) {
    failures.push(`canonical/v2/repos: ${missingTrackingStatus} repo(s) are missing explicit active status`);
  }
  if (missingTrackedSinceField > 0) {
    failures.push(`canonical/v2/repos: ${missingTrackedSinceField} repo(s) are missing explicit tracked_since provenance`);
  }
  if (finalize && repoIds.size === 0 && !allowPlaceholder) {
    failures.push("canonical/v2/repos: no repository records");
  }
  if (repoIdentityFailures > 0) {
    failures.push(`canonical/v2/repos: ${repoIdentityFailures} record key(s) do not match their repository id`);
  }
  if (bucketPlacementFailures > 0) {
    failures.push(`canonical/v2: ${bucketPlacementFailures} record(s) are stored in the wrong bucket`);
  }

  if (options.scope !== "repositories") {
    for (const spec of SHARD_SPECS.slice(1)) {
      const records = recordsByKind.get(spec.kind) ?? 0;
      if (finalize && repoIds.size > 0 && records === 0 && !allowPlaceholder) {
        failures.push(`canonical/v2/${spec.kind}: no repository records for ${repoIds.size} canonical repo(s)`);
      }
      const orphanRecords = [...(seriesRepoIds.get(spec.kind) ?? [])].filter((id) => !repoIds.has(id)).length;
      if (orphanRecords > 0) {
        failures.push(
          `canonical/v2/${spec.kind}: ${orphanRecords} record(s) reference repositories absent from canonical/v2/repos`,
        );
      }
    }
  }

  const acc: CanonicalPreflightAcc = {
    repoRecords: recordsByKind.get("repos") ?? 0,
    monthlyRecords: recordsByKind.get("repo-monthly") ?? 0,
    weeklyRecords: recordsByKind.get("repo-weekly") ?? 0,
    recentDailyRecords: recordsByKind.get("repo-recent-daily") ?? 0,
    validatedShards: shards.length,
    schemaFailures,
    placeholderShards: placeholders.length,
  };

  const manifest = CanonicalGenerationManifest.parse({
    run_id: runId,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    expected_shards: expectedShards,
    validated_shards: shards.length,
    total_records: shards.reduce((sum, shard) => sum + shard.records, 0),
    complete: shards.length === expectedShards && failures.length === 0,
    shards,
  });

  return {
    manifest,
    checked: expectedShards,
    schemaFailures,
    invariants: {
      ...dInvariants,
      canonical_expected_shards: expectedShards,
      canonical_validated_shards: shards.length,
      canonical_total_records: manifest.total_records,
      canonical_repo_records: acc.repoRecords,
      canonical_repo_monthly_records: acc.monthlyRecords,
      canonical_repo_weekly_records: acc.weeklyRecords,
      canonical_repo_recent_daily_records: acc.recentDailyRecords,
      canonical_active_repos: activeRepoIds.size,
      canonical_historical_repos: historicalRepos,
      canonical_missing_tracking_status: missingTrackingStatus,
      canonical_missing_tracked_since: missingTrackedSinceField,
      canonical_repo_identity_failures: repoIdentityFailures,
      canonical_bucket_placement_failures: bucketPlacementFailures,
      canonical_complete: manifest.complete,
      canonical_placeholder_shards: placeholders.length,
    },
    failures,
    placeholders,
    repoIds,
    activeRepoIds,
    acc,
  };
}
