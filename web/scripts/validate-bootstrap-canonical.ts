// Validate every locally exported canonical/v2 bootstrap artifact before any
// generation can become visible through bootstrap/latest.json.
//   cd web && bun scripts/validate-bootstrap-canonical.ts ../pipeline/data/v2/canonical/v2
import { fileURLToPath } from "node:url";
import {
  BOOTSTRAP_CANONICAL_OK,
  bootstrapCanonicalFailureLines,
  canonicalDirectoryError,
  inspectLocalBootstrapCanonical,
} from "./lib/validate-bootstrap-canonical";

const root = process.argv[2] ?? fileURLToPath(new URL("../../pipeline/data/v2/canonical/v2", import.meta.url));

const directoryError = canonicalDirectoryError(root);
if (directoryError) {
  console.error(directoryError);
  process.exit(2);
}

const report = await inspectLocalBootstrapCanonical(root);
console.log(report.summary);
if (report.exitCode === 1) {
  for (const line of bootstrapCanonicalFailureLines(report.failures)) console.error(line);
  process.exit(1);
}
console.log(BOOTSTRAP_CANONICAL_OK);
