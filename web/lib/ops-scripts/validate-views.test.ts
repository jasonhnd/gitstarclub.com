import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewValidationResult } from "@/lib/view-validation";
import { validateViewDirectory } from "@/lib/view-validation";
import {
  VALIDATE_VIEWS_OK,
  validateViewsReport,
  viewDirectoryError,
} from "../../scripts/lib/validate-views-cli";

describe("validate-views CLI", () => {
  test("refuses a missing path and a file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "validate-views-"));
    const file = join(dir, "not-a-dir.json");
    writeFileSync(file, "{}\n");
    try {
      expect(viewDirectoryError(join(dir, "missing"))).toBe(
        `view directory not found: ${join(dir, "missing")}`,
      );
      expect(viewDirectoryError(file)).toBe(`view directory not found: ${file}`);
      expect(viewDirectoryError(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty directory is a successful zero-discovery report", () => {
    const dir = mkdtempSync(join(tmpdir(), "validate-views-"));
    try {
      const report = validateViewsReport(validateViewDirectory(dir), dir);
      expect(report.exitCode).toBe(0);
      expect(report.summary).toBe(`discovered 0; validated 0; allowlisted 0; skipped 0; failed 0 in ${dir}`);
      expect(report.successLine).toBe(VALIDATE_VIEWS_OK);
      expect(report.failureHeader).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown JSON fails, and the printer keeps the first 20 failures in kind order", () => {
    const dir = mkdtempSync(join(tmpdir(), "validate-views-"));
    try {
      mkdirSync(join(dir, "nested"));
      writeFileSync(join(dir, "nested", "nope.json"), "{}\n");
      const report = validateViewsReport(validateViewDirectory(dir), dir);
      expect(report.exitCode).toBe(1);
      expect(report.failureLines[0]).toContain("unknown JSON view path");
      expect(report.successLine).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const failures = Array.from({ length: 21 }, (_, index) => ({
      path: `p${index}.json`,
      reason: "bad",
    }));
    const result: ViewValidationResult = {
      discovered: 23,
      validated: 3,
      allowlisted: 1,
      skipped: 0,
      failed: 21,
      byKind: new Map([
        ["zeta", 1],
        ["alpha", 2],
      ]),
      failures,
      allowlistedFiles: [{ path: "x.json", reason: "because" }],
    };
    const formatted = validateViewsReport(result, "/views");
    expect(formatted.kindLines).toEqual(["  alpha: 2", "  zeta: 1"]);
    expect(formatted.allowlistedLines).toEqual(["  allowlisted x.json: because"]);
    expect(formatted.failureHeader).toBe("\n21 FAILURES:");
    expect(formatted.failureLines).toHaveLength(20);
    expect(formatted.failureLines[0]).toBe("  p0.json: bad");
    expect(formatted.failureLines[19]).toBe("  p19.json: bad");
    expect(formatted.summary).toContain("failed 21 in /views");
  });
});
