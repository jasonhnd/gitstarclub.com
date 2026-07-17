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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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
    const root = mkdtempSync(join(tmpdir(), "gsc-low-coverage-"));
    roots.push(root);
    const report = join(root, "lcov.info");
    writeFileSync(report, "LF:100\nLH:79\nFNF:10\nFNH:7\nend_of_record\n");

    const result = spawnSync("node", [new URL("../../scripts/check-coverage-threshold.mjs", import.meta.url).pathname, report], {
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "coverage threshold failed: lines 79.00% < 80.00%; functions 70.00% < 80.00%",
    );
  });
});
