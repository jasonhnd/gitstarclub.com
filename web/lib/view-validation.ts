import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ZodType } from "zod";
import {
  AliasMap,
  CategoriesLookup,
  CategoryAssignmentsDocument,
  CategoryAssignmentsShard,
  CategoryRankList,
  CategoryRegistry,
  CurrentMonthDocument,
  CurrentMonthShard,
  Heatmap,
  HotSnapshot,
  LiveGenerationManifest,
  Meta,
  OrgsLookup,
  OrgEntity,
  PendingPeriod,
  RankList,
  RepoEntity,
  ReposLookup,
  SearchIndex,
} from "./contracts";

export interface ViewContract {
  kind: string;
  schema: ZodType;
}

export interface ViewValidationAllowlistEntry {
  pattern: RegExp;
  reason: string;
}

export interface ViewValidationFailure {
  path: string;
  reason: string;
}

export interface ViewValidationResult {
  discovered: number;
  validated: number;
  allowlisted: number;
  skipped: number;
  failed: number;
  byKind: Map<string, number>;
  failures: ViewValidationFailure[];
  allowlistedFiles: Array<{ path: string; reason: string }>;
}

/**
 * Intentional non-view JSON artifacts must be listed here with a narrow pattern
 * and an operator-readable reason. Unknown JSON fails closed by default.
 */
export const VIEW_VALIDATION_ALLOWLIST: readonly ViewValidationAllowlistEntry[] = [];

function normalizeViewPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

/** Resolve a generated view path to its authoritative Zod contract. */
export function contractForViewPath(path: string): ViewContract | null {
  const normalized = normalizeViewPath(path);
  const versionRelative = normalized.replace(/^views\/[^/]+\//, "");
  const liveGeneration = /^live\/generations\/[^/]+\/(.+)$/.exec(versionRelative);
  const rel = liveGeneration?.[1] ?? (versionRelative.startsWith("live/") ? versionRelative.slice("live/".length) : versionRelative);

  if (liveGeneration && rel === "manifest.json") return { kind: "live/manifest", schema: LiveGenerationManifest };
  if (liveGeneration && /^rollover\/[^/]+\.json$/.test(rel)) return { kind: "live/rollover", schema: PendingPeriod };
  if (rel === "meta.json") return { kind: "meta", schema: Meta };
  if (rel === "hot-snapshot.json") return { kind: "hot-snapshot", schema: HotSnapshot };
  if (rel === "current_month.json") return { kind: "current-month", schema: CurrentMonthDocument };
  if (/^current_month\/shards\/\d+\.json$/.test(rel)) return { kind: "current-month-shard", schema: CurrentMonthShard };
  if (rel === "lookup/repos.json") return { kind: "lookup/repos", schema: ReposLookup };
  if (rel === "lookup/orgs.json") return { kind: "lookup/orgs", schema: OrgsLookup };
  if (rel === "lookup/aliases.json") return { kind: "lookup/aliases", schema: AliasMap };
  if (rel === "lookup/categories.json") return { kind: "lookup/categories", schema: CategoriesLookup };
  if (rel === "categories/registry.json") return { kind: "categories/registry", schema: CategoryRegistry };
  if (rel === "categories/assignments.json") return { kind: "categories/assignments", schema: CategoryAssignmentsDocument };
  if (/^categories\/assignments\/shards\/\d+\.json$/.test(rel)) {
    return { kind: "categories/assignments-shard", schema: CategoryAssignmentsShard };
  }
  if (rel === "search/index.json") return { kind: "search/index", schema: SearchIndex };
  if (/^rank\/category\/.+\.json$/.test(rel)) return { kind: "rank/category", schema: CategoryRankList };
  if (/^rank\/.+\.json$/.test(rel)) return { kind: "rank", schema: RankList };
  if (/^entity\/repo\/[^/]+\.json$/.test(rel)) return { kind: "entity/repo", schema: RepoEntity };
  if (/^entity\/org\/[^/]+\.json$/.test(rel)) return { kind: "entity/org", schema: OrgEntity };
  if (/^heatmap\/(?:year|month)\/[^/]+\.json$/.test(rel)) return { kind: "heatmap", schema: Heatmap };
  return null;
}

function walkJsonFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).toSorted()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walkJsonFiles(full));
    else if (name.endsWith(".json")) files.push(full);
  }
  return files;
}

export function validateViewDirectory(
  viewsDir: string,
  options: { allowlist?: readonly ViewValidationAllowlistEntry[] } = {},
): ViewValidationResult {
  const allowlist = options.allowlist ?? VIEW_VALIDATION_ALLOWLIST;
  const files = walkJsonFiles(viewsDir);
  const byKind = new Map<string, number>();
  const failures: ViewValidationFailure[] = [];
  const allowlistedFiles: Array<{ path: string; reason: string }> = [];
  let validated = 0;

  for (const file of files) {
    const rel = normalizeViewPath(relative(viewsDir, file));
    const contract = contractForViewPath(rel);
    if (!contract) {
      const allowed = allowlist.find((entry) => entry.pattern.test(rel));
      if (allowed) {
        allowlistedFiles.push({ path: rel, reason: allowed.reason });
      } else {
        failures.push({ path: rel, reason: "unknown JSON view path (no registered contract)" });
      }
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      failures.push({ path: rel, reason: `malformed JSON — ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }

    const result = contract.schema.safeParse(value);
    if (!result.success) {
      failures.push({
        path: rel,
        reason: result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`.trim()).join("; "),
      });
      continue;
    }

    validated++;
    byKind.set(contract.kind, (byKind.get(contract.kind) ?? 0) + 1);
  }

  return {
    discovered: files.length,
    validated,
    allowlisted: allowlistedFiles.length,
    skipped: 0,
    failed: failures.length,
    byKind,
    failures,
    allowlistedFiles,
  };
}
