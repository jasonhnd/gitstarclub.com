import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const COVERAGE_THRESHOLD = 0.8;

export function parseLcovTotals(content) {
  const totals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("LF:")) totals.linesFound += Number(line.slice(3));
    else if (line.startsWith("LH:")) totals.linesHit += Number(line.slice(3));
    else if (line.startsWith("FNF:")) totals.functionsFound += Number(line.slice(4));
    else if (line.startsWith("FNH:")) totals.functionsHit += Number(line.slice(4));
  }
  return totals;
}

function ratio(hit, found) {
  return found === 0 ? 1 : hit / found;
}

export function assertCoverageThreshold(totals, threshold = COVERAGE_THRESHOLD) {
  const lines = ratio(totals.linesHit, totals.linesFound);
  const functions = ratio(totals.functionsHit, totals.functionsFound);
  const failures = [];
  if (lines < threshold) failures.push(`lines ${(lines * 100).toFixed(2)}% < ${(threshold * 100).toFixed(2)}%`);
  if (functions < threshold) failures.push(`functions ${(functions * 100).toFixed(2)}% < ${(threshold * 100).toFixed(2)}%`);
  if (failures.length > 0) throw new Error(`coverage threshold failed: ${failures.join("; ")}`);
  return { lines, functions };
}

export function checkCoverageFile(path, threshold = COVERAGE_THRESHOLD) {
  return assertCoverageThreshold(parseLcovTotals(readFileSync(path, "utf8")), threshold);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const path = resolve(process.argv[2] ?? "web/coverage/lcov.info");
    const result = checkCoverageFile(path);
    console.log(`coverage gate passed: lines ${(result.lines * 100).toFixed(2)}%; functions ${(result.functions * 100).toFixed(2)}%`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
