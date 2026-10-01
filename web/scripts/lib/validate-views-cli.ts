import { existsSync, statSync } from "node:fs";
import type { ViewValidationResult } from "@/lib/view-validation";

export const VALIDATE_VIEWS_OK = "all discovered JSON views are validated or explicitly allowlisted ✓";

export function viewDirectoryError(viewsDir: string): string | null {
  if (!existsSync(viewsDir) || !statSync(viewsDir).isDirectory()) {
    return `view directory not found: ${viewsDir}`;
  }
  return null;
}

export type ValidateViewsReport = {
  summary: string;
  kindLines: string[];
  allowlistedLines: string[];
  failureHeader: string | null;
  failureLines: string[];
  successLine: string | null;
  exitCode: 0 | 1;
};

/** Format the directory result the same way the validate-views CLI prints it. */
export function validateViewsReport(result: ViewValidationResult, viewsDir: string): ValidateViewsReport {
  const failureLines = result.failures.slice(0, 20).map((failure) => `  ${failure.path}: ${failure.reason}`);
  const failed = result.failures.length > 0;
  return {
    summary: `discovered ${result.discovered}; validated ${result.validated}; allowlisted ${result.allowlisted}; skipped ${result.skipped}; failed ${result.failed} in ${viewsDir}`,
    kindLines: [...result.byKind].sort().map(([kind, count]) => `  ${kind}: ${count}`),
    allowlistedLines: result.allowlistedFiles.map((file) => `  allowlisted ${file.path}: ${file.reason}`),
    failureHeader: failed ? `\n${result.failures.length} FAILURES:` : null,
    failureLines,
    successLine: failed ? null : VALIDATE_VIEWS_OK,
    exitCode: failed ? 1 : 0,
  };
}
