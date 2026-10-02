import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { ZodType } from "zod";
import { CanonicalMeta, SiteDaily } from "@/lib/contracts";
import { EXPECTED_CANONICAL_SHARDS, validateCanonicalGeneration } from "@/lib/workflows/canonical-validation";

export const BOOTSTRAP_CANONICAL_OK = "all canonical bootstrap artifacts validated ✓";

export function canonicalDirectoryError(root: string): string | null {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return `canonical directory not found: ${root}`;
  }
  return null;
}

export function canonicalLogicalRelative(logicalPath: string): string {
  return logicalPath.replace(/^canonical\/v2\//, "");
}

export function siteDailyShardNames(names: readonly string[]): string[] {
  return names.filter((name) => /^\d{4}\.json$/.test(name)).toSorted();
}

export function bootstrapCanonicalFailureLines(failures: readonly string[]): string[] {
  return failures.slice(0, 30).map((failure) => `  ${failure}`);
}

export type BootstrapCanonicalReport = {
  summary: string;
  failures: string[];
  exitCode: 0 | 1;
};

/** Local canonical/v2 inspection used by validate-bootstrap-canonical.ts. */
export async function inspectLocalBootstrapCanonical(root: string): Promise<BootstrapCanonicalReport> {
  function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8"));
  }

  const reader = async (logicalPath: string, schema: ZodType): Promise<unknown | null> => {
    const physical = `${root}/${canonicalLogicalRelative(logicalPath)}`;
    if (!existsSync(physical)) return null;
    return schema.parse(readJson(physical));
  };

  const validation = await validateCanonicalGeneration("bootstrap-local", {
    reader,
    generatedAt: new Date(0).toISOString(),
  });
  const failures = [...validation.failures];

  try {
    CanonicalMeta.parse(readJson(`${root}/meta.json`));
  } catch (error) {
    failures.push(`canonical/v2/meta.json: ${error instanceof Error ? error.message : String(error)}`);
  }

  const siteDailyDir = `${root}/site-daily`;
  const siteDailyFiles = existsSync(siteDailyDir) ? siteDailyShardNames(readdirSync(siteDailyDir)) : [];
  if (siteDailyFiles.length === 0) failures.push("canonical/v2/site-daily: no yearly shard found");
  for (const file of siteDailyFiles) {
    try {
      SiteDaily.parse(readJson(`${siteDailyDir}/${file}`));
    } catch (error) {
      failures.push(`canonical/v2/site-daily/${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    summary: `canonical bootstrap: required_shards=${validation.checked}/${EXPECTED_CANONICAL_SHARDS} site_daily=${siteDailyFiles.length} failures=${failures.length}`,
    failures,
    exitCode: failures.length > 0 ? 1 : 0,
  };
}
