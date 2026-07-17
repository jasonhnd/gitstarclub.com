import type { ZodType } from "zod";
import { readView } from "@/lib/data/source";
import {
  CanonicalGenerationManifest,
  RepoMonthlyShard,
  RepoRecentDailyShard,
  ReposShard,
  RepoWeeklyShard,
  type ReposShardEntry,
} from "@/lib/contracts";
import { REPO_BUCKETS } from "./buckets";

export const HIGH_D_FACTOR_WARN_THRESHOLD = 2;

const SHARD_SPECS = [
  { kind: "repos", schema: ReposShard },
  { kind: "repo-monthly", schema: RepoMonthlyShard },
  { kind: "repo-weekly", schema: RepoWeeklyShard },
  { kind: "repo-recent-daily", schema: RepoRecentDailyShard },
] as const;

export const EXPECTED_CANONICAL_SHARDS = SHARD_SPECS.length * REPO_BUCKETS;

export type CanonicalShardReader = (path: string, schema: ZodType) => Promise<unknown | null>;

export interface CanonicalValidationResult {
  manifest: CanonicalGenerationManifest;
  checked: number;
  schemaFailures: number;
  invariants: Record<string, boolean | number>;
  failures: string[];
  repoIds: Set<string>;
}

type AnchoringShard = Record<string, Pick<ReposShardEntry, "d" | "tracked_since">>;

export function inspectAnchoringFactors(
  shards: AnchoringShard[],
  threshold = HIGH_D_FACTOR_WARN_THRESHOLD,
): Record<string, boolean | number> {
  let reposChecked = 0;
  let reposWithD = 0;
  let historicalMissingD = 0;
  let newcomerDefaultD = 0;
  let highCount = 0;
  let maxD = 0;

  for (const shard of shards) {
    for (const repo of Object.values(shard)) {
      reposChecked++;
      if (typeof repo.d !== "number" || !Number.isFinite(repo.d)) {
        if (repo.tracked_since == null) historicalMissingD++;
        else newcomerDefaultD++;
        continue;
      }
      reposWithD++;
      maxD = Math.max(maxD, repo.d);
      if (repo.d > threshold) highCount++;
    }
  }

  return {
    d_factor_warn_threshold: threshold,
    d_factor_repos_checked: reposChecked,
    d_factor_repos_with_d: reposWithD,
    d_factor_historical_missing: historicalMissingD,
    d_factor_newcomer_default_zero: newcomerDefaultD,
    d_factor_high_count: highCount,
    d_factor_max: Math.round(maxD * 1000) / 1000,
    d_factor_warning: highCount > 0,
  };
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

export async function validateCanonicalGeneration(
  runId: string,
  options: { reader?: CanonicalShardReader; generatedAt?: string } = {},
): Promise<CanonicalValidationResult> {
  const reader = options.reader ?? ((path, schema) => readView(path, schema, { bust: runId }));
  const failures: string[] = [];
  const repoShards: AnchoringShard[] = [];
  const repoIds = new Set<string>();
  let schemaFailures = 0;

  const results = await Promise.all(
    SHARD_SPECS.flatMap((spec) =>
      Array.from({ length: REPO_BUCKETS }, async (_, bucket) => {
        const path = `canonical/v2/${spec.kind}/${bucket}.json`;
        try {
          const value = await reader(path, spec.schema);
          if (value === null) {
            failures.push(`${path}: missing`);
            return null;
          }
          const parsed = spec.schema.safeParse(value);
          if (!parsed.success) {
            schemaFailures++;
            failures.push(`${path}: schema — ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`.trim()).join("; ")}`);
            return null;
          }
          const records = Object.keys(parsed.data as Record<string, unknown>).length;
          if (spec.kind === "repos") {
            const shard = parsed.data as AnchoringShard;
            repoShards.push(shard);
            for (const id of Object.keys(shard)) repoIds.add(id);
          }
          return { path, kind: spec.kind, bucket, records, sha256: await checksum(parsed.data) };
        } catch (error) {
          schemaFailures++;
          failures.push(`${path}: schema/read — ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      }),
    ),
  );

  const shards = results.filter((entry): entry is NonNullable<typeof entry> => entry !== null).toSorted((a, b) =>
    a.path.localeCompare(b.path),
  );
  const dInvariants = inspectAnchoringFactors(repoShards);
  const historicalMissing = Number(dInvariants.d_factor_historical_missing ?? 0);
  if (historicalMissing > 0) {
    failures.push(`canonical/v2/repos: ${historicalMissing} historical repo(s) are missing a finite anchoring factor d`);
  }

  const manifest = CanonicalGenerationManifest.parse({
    run_id: runId,
    generated_at: options.generatedAt ?? new Date().toISOString(),
    expected_shards: EXPECTED_CANONICAL_SHARDS,
    validated_shards: shards.length,
    total_records: shards.reduce((sum, shard) => sum + shard.records, 0),
    complete: shards.length === EXPECTED_CANONICAL_SHARDS && failures.length === 0,
    shards,
  });

  return {
    manifest,
    checked: EXPECTED_CANONICAL_SHARDS,
    schemaFailures,
    invariants: {
      ...dInvariants,
      canonical_expected_shards: EXPECTED_CANONICAL_SHARDS,
      canonical_validated_shards: shards.length,
      canonical_total_records: manifest.total_records,
      canonical_complete: manifest.complete,
    },
    failures,
    repoIds,
  };
}
