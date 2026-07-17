// Validate every locally exported canonical/v2 bootstrap artifact before any
// generation can become visible through bootstrap/latest.json.
//   cd web && bun scripts/validate-bootstrap-canonical.ts ../pipeline/data/v2/canonical/v2
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import { CanonicalMeta, SiteDaily } from "../lib/contracts";
import { EXPECTED_CANONICAL_SHARDS, validateCanonicalGeneration } from "../lib/workflows/canonical-validation";

const root = process.argv[2] ?? fileURLToPath(new URL("../../pipeline/data/v2/canonical/v2", import.meta.url));

if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`canonical directory not found: ${root}`);
  process.exit(2);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const reader = async (logicalPath: string, schema: ZodType): Promise<unknown | null> => {
  const relative = logicalPath.replace(/^canonical\/v2\//, "");
  const physical = `${root}/${relative}`;
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
const siteDailyFiles = existsSync(siteDailyDir)
  ? readdirSync(siteDailyDir).filter((name) => /^\d{4}\.json$/.test(name)).toSorted()
  : [];
if (siteDailyFiles.length === 0) failures.push("canonical/v2/site-daily: no yearly shard found");
for (const file of siteDailyFiles) {
  try {
    SiteDaily.parse(readJson(`${siteDailyDir}/${file}`));
  } catch (error) {
    failures.push(`canonical/v2/site-daily/${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log(
  `canonical bootstrap: required_shards=${validation.checked}/${EXPECTED_CANONICAL_SHARDS} site_daily=${siteDailyFiles.length} failures=${failures.length}`,
);
if (failures.length > 0) {
  for (const failure of failures.slice(0, 30)) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("all canonical bootstrap artifacts validated ✓");
