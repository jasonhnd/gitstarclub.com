// Validates pipeline JSON views against the Zod contracts (single source of truth).
// Run with bun (resolves web/node_modules/zod + parses TS contracts directly):
//   cd web && bun scripts/validate-views.ts [viewsDir]
// Default viewsDir = ../pipeline/data/views. Exits non-zero on any contract violation.

import { fileURLToPath } from "node:url";
import { validateViewDirectory } from "../lib/view-validation";
import { validateViewsReport, viewDirectoryError } from "./lib/validate-views-cli";

const viewsDir =
  process.argv[2] ?? fileURLToPath(new URL("../../pipeline/data/views", import.meta.url));

const directoryError = viewDirectoryError(viewsDir);
if (directoryError) {
  console.error(directoryError);
  process.exit(2);
}

const report = validateViewsReport(validateViewDirectory(viewsDir), viewsDir);
console.log(report.summary);
for (const line of report.kindLines) console.log(line);
for (const line of report.allowlistedLines) console.log(line);
if (report.exitCode === 1) {
  console.error(report.failureHeader);
  for (const line of report.failureLines) console.error(line);
  process.exit(1);
}
console.log(report.successLine);
