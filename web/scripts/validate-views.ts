// Validates pipeline JSON views against the Zod contracts (single source of truth).
// Run with bun (resolves web/node_modules/zod + parses TS contracts directly):
//   cd web && bun scripts/validate-views.ts [viewsDir]
// Default viewsDir = ../pipeline/data/views. Exits non-zero on any contract violation.

import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateViewDirectory } from "../lib/view-validation";

const viewsDir =
  process.argv[2] ?? fileURLToPath(new URL("../../pipeline/data/views", import.meta.url));

if (!existsSync(viewsDir) || !statSync(viewsDir).isDirectory()) {
  console.error(`view directory not found: ${viewsDir}`);
  process.exit(2);
}

const result = validateViewDirectory(viewsDir);
console.log(
  `discovered ${result.discovered}; validated ${result.validated}; allowlisted ${result.allowlisted}; skipped ${result.skipped}; failed ${result.failed} in ${viewsDir}`,
);
for (const [kind, count] of [...result.byKind].sort()) console.log(`  ${kind}: ${count}`);
for (const file of result.allowlistedFiles) console.log(`  allowlisted ${file.path}: ${file.reason}`);
if (result.failures.length) {
  console.error(`\n${result.failures.length} FAILURES:`);
  for (const failure of result.failures.slice(0, 20)) console.error(`  ${failure.path}: ${failure.reason}`);
  process.exit(1);
}
console.log("all discovered JSON views are validated or explicitly allowlisted ✓");
