// Validates pipeline JSON views against the Zod contracts (single source of truth).
// Run with bun (resolves web/node_modules/zod + parses TS contracts directly):
//   cd web && bun scripts/validate-views.ts [viewsDir]
// Default viewsDir = ../pipeline/data/views. Exits non-zero on any contract violation.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import type { ZodType } from "zod";
import { Meta, ReposLookup, OrgsLookup, RankList, RepoEntity, OrgEntity, Heatmap, HotSnapshot } from "../lib/contracts/index";

const viewsDir =
  process.argv[2] ?? fileURLToPath(new URL("../../pipeline/data/views", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Route a view file (by its path relative to viewsDir, forward-slashed) to its schema. */
function schemaFor(rel: string): ZodType | null {
  if (rel === "meta.json") return Meta;
  if (rel === "hot-snapshot.json") return HotSnapshot;
  if (rel === "lookup/repos.json") return ReposLookup;
  if (rel === "lookup/orgs.json") return OrgsLookup;
  if (rel.startsWith("rank/")) return RankList;
  if (rel.startsWith("entity/repo/")) return RepoEntity;
  if (rel.startsWith("entity/org/")) return OrgEntity;
  if (rel.startsWith("heatmap/")) return Heatmap;
  return null;
}

const files = walk(viewsDir);
let ok = 0;
let skipped = 0;
const failures: string[] = [];
const byKind = new Map<string, number>();

for (const file of files) {
  const rel = relative(viewsDir, file).replaceAll("\\", "/");
  const schema = schemaFor(rel);
  if (!schema) {
    skipped++;
    continue;
  }
  const kind = rel.split("/").slice(0, rel.startsWith("rank/") ? 1 : 2).join("/");
  const result = schema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (result.success) {
    ok++;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  } else if (failures.length < 10) {
    failures.push(`${rel}: ${result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  } else {
    failures.push(rel);
  }
}

console.log(`validated ${ok}/${ok + failures.length} files (${skipped} skipped) in ${viewsDir}`);
for (const [kind, n] of [...byKind].sort()) console.log(`  ${kind}: ${n}`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURES:`);
  for (const f of failures.slice(0, 10)) console.error(`  ${f}`);
  process.exit(1);
}
console.log("all views conform to contracts ✓");
