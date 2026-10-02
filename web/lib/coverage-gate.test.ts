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

  test("a missing counter in one record is not hidden by a later record", () => {
    const result = runGate(
      writeReport(
        "coverage-mixed-missing",
        "SF:a.ts\nLH:70\nFNF:10\nFNH:10\nend_of_record\nSF:b.ts\nLF:100\nLH:20\nFNF:10\nFNH:10\nend_of_record\n",
      ),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report missing counters: LF (a.ts)");
    expect(result.stdout).not.toContain("coverage gate passed");
  });

  test("hit greater than found in one record is not hidden by a later record", () => {
    const result = runGate(
      writeReport(
        "coverage-mixed-hit",
        "SF:a.ts\nLF:10\nLH:20\nFNF:10\nFNH:10\nend_of_record\nSF:b.ts\nLF:90\nLH:70\nFNF:10\nFNH:10\nend_of_record\n",
      ),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("coverage report invalid: hit exceeds found (a.ts)");
    expect(result.stdout).not.toContain("coverage gate passed");
  });

  test("a second SF before end_of_record exits non-zero", () => {
    const missingSeparator = runGate(
      writeReport(
        "coverage-sf-missing",
        "SF:a.ts\nLH:70\nFNF:10\nFNH:10\nSF:b.ts\nLF:100\nLH:20\nFNF:10\nFNH:10\nend_of_record\n",
      ),
    );
    expect(missingSeparator.status).not.toBe(0);
    expect(missingSeparator.stderr).toContain("coverage report malformed: SF before end_of_record (a.ts)");
    expect(missingSeparator.stdout).not.toContain("coverage gate passed");

    const hitWithoutSeparator = runGate(
      writeReport(
        "coverage-sf-hit",
        "SF:a.ts\nLF:10\nLH:20\nFNF:10\nFNH:10\nSF:b.ts\nLF:90\nLH:70\nFNF:10\nFNH:10\nend_of_record\n",
      ),
    );
    expect(hitWithoutSeparator.status).not.toBe(0);
    expect(hitWithoutSeparator.stderr).toContain("coverage report malformed: SF before end_of_record (a.ts)");
    expect(hitWithoutSeparator.stdout).not.toContain("coverage gate passed");
  });

  test("a repeated summary counter exits non-zero", () => {
    const duplicates = [
      ["coverage-dup-lf", "SF:a.ts\nLF:10\nLH:20\nLF:90\nLH:70\nFNF:10\nFNH:10\nend_of_record\n", "LF"],
      ["coverage-dup-lh", "SF:a.ts\nLF:100\nLH:0\nLH:90\nFNF:10\nFNH:9\nend_of_record\n", "LH"],
      ["coverage-dup-fnf", "SF:a.ts\nLF:100\nLH:90\nFNF:1\nFNF:9\nFNH:9\nend_of_record\n", "FNF"],
      ["coverage-dup-fnh", "SF:a.ts\nLF:100\nLH:90\nFNF:10\nFNH:0\nFNH:9\nend_of_record\n", "FNH"],
    ] as const;
    for (const [name, body, label] of duplicates) {
      const result = runGate(writeReport(name, body));
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`coverage report duplicate counter: ${label} (a.ts)`);
      expect(result.stdout).not.toContain("coverage gate passed");
    }
  });

  test("a zero-function record still counts inside a nonempty aggregate", () => {
    const report = [
      "SF:a.ts",
      "LF:10",
      "LH:10",
      "FNF:0",
      "FNH:0",
      "end_of_record",
      "SF:b.ts",
      "LF:90",
      "LH:80",
      "FNF:10",
      "FNH:8",
      "end_of_record",
      "",
    ].join("\n");
    expect(parseLcovTotals(report)).toEqual({
      linesFound: 100,
      linesHit: 90,
      functionsFound: 10,
      functionsHit: 8,
    });
    const result = runGate(writeReport("coverage-zero-functions", report));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("coverage gate passed: lines 90.00%; functions 80.00%");
  });
});
