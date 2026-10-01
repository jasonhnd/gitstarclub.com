import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  assertCoverageThreshold,
  COVERAGE_THRESHOLD,
  parseLcovTotals,
} from "../../scripts/check-coverage-threshold.mjs";

const roots: string[] = [];
const gateScript = new URL("../../scripts/check-coverage-threshold.mjs", import.meta.url).pathname;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeReport(name: string, body: string) {
  const root = mkdtempSync(join(tmpdir(), `gsc-${name}-`));
  roots.push(root);
  const report = join(root, "lcov.info");
  writeFileSync(report, body);
  return report;
}

function runGate(report: string) {
  return spawnSync("node", [gateScript, report], { encoding: "utf8" });
}

describe("coverage release gate", () => {
  test("pins both documented aggregate dimensions to 80 percent", () => {
    expect(COVERAGE_THRESHOLD).toBe(0.8);
    expect(
      assertCoverageThreshold({ linesFound: 100, linesHit: 80, functionsFound: 10, functionsHit: 8 }),
    ).toEqual({ lines: 0.8, functions: 0.8 });
  });

  test("parses LCOV totals across multiple first-party modules", () => {
    expect(parseLcovTotals("LF:10\nLH:8\nFNF:4\nFNH:3\nend_of_record\nLF:5\nLH:5\nFNF:1\nFNH:1\n")).toEqual({
      linesFound: 15,
      linesHit: 13,
      functionsFound: 5,
      functionsHit: 4,
    });
  });

  test("a controlled below-threshold report exits non-zero", () => {
    const report = writeReport("low-coverage", "LF:100\nLH:79\nFNF:10\nFNH:7\nend_of_record\n");

    const result = runGate(report);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "coverage threshold failed: lines 79.00% < 80.00%; functions 70.00% < 80.00%",
    );
  });

  test("exact 80 percent and a valid 90 percent report pass the CLI", () => {
    const atThreshold = runGate(writeReport("coverage-80", "LF:100\nLH:80\nFNF:10\nFNH:8\nend_of_record\n"));
    expect(atThreshold.status).toBe(0);
    expect(atThreshold.stdout).toContain("coverage gate passed: lines 80.00%; functions 80.00%");

    const aboveThreshold = runGate(writeReport("coverage-90", "LF:100\nLH:90\nFNF:10\nFNH:9\nend_of_record\n"));
    expect(aboveThreshold.status).toBe(0);
    expect(aboveThreshold.stdout).toContain("coverage gate passed: lines 90.00%; functions 90.00%");
  });

  test("an empty report exits non-zero", () => {
    const result = runGate(writeReport("coverage-empty", ""));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report empty");
  });

  test("a malformed counter exits non-zero", () => {
    const result = runGate(writeReport("coverage-malformed", "LF:n/a\nLH:90\nFNF:10\nFNH:9\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report malformed: LF is not an integer");
  });

  test("missing aggregate counters exit non-zero", () => {
    const result = runGate(writeReport("coverage-missing", "LF:100\nLH:90\nend_of_record\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report missing counters: FNF, FNH");
  });

  test("a negative counter exits non-zero", () => {
    const result = runGate(writeReport("coverage-negative", "LF:-10\nLH:-9\nFNF:-10\nFNH:-9\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report negative counter: LF");
  });

  test("hit greater than found exits non-zero", () => {
    const result = runGate(writeReport("coverage-hit-found", "LF:10\nLH:11\nFNF:4\nFNH:4\n"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report invalid: hit exceeds found");
  });

  test("explicit zero totals are not treated as full coverage", () => {
    expect(() => parseLcovTotals("LF:0\nLH:0\nFNF:0\nFNH:0\n")).toThrow(
      "coverage report invalid: aggregate found is zero",
    );
  });
});
