import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const COVERAGE_THRESHOLD = 0.8;

const COUNTERS = /** @type {const} */ ([
  { prefix: "LF:", key: "linesFound", label: "LF" },
  { prefix: "LH:", key: "linesHit", label: "LH" },
  { prefix: "FNF:", key: "functionsFound", label: "FNF" },
  { prefix: "FNH:", key: "functionsHit", label: "FNH" },
]);

/**
 * @param {string} raw
 * @param {string} label
 */
function parseCounter(raw, label) {
  if (/^-\d+$/.test(raw)) {
    throw new Error(`coverage report negative counter: ${label}`);
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`coverage report malformed: ${label} is not an integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`coverage report malformed: ${label} is not an integer`);
  }
  return value;
}

/**
 * @param {string[]} lines
 * @returns {{ linesFound: number, linesHit: number, functionsFound: number, functionsHit: number } | null}
 */
function parseRecord(lines) {
  const totals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
  const seen = { linesFound: false, linesHit: false, functionsFound: false, functionsHit: false };
  let sourceFile = "";
  let sourceOpen = false;
  let meaningful = false;
  for (const line of lines) {
    if (line.trim() === "") continue;
    meaningful = true;
    if (line.startsWith("SF:")) {
      if (sourceOpen) {
        const where = sourceFile ? ` (${sourceFile})` : "";
        throw new Error(`coverage report malformed: SF before end_of_record${where}`);
      }
      sourceOpen = true;
      sourceFile = line.slice(3).trim();
      continue;
    }
    const counter = COUNTERS.find((item) => line.startsWith(item.prefix));
    if (!counter) continue;
    const where = sourceFile ? ` (${sourceFile})` : "";
    if (seen[counter.key]) {
      throw new Error(`coverage report duplicate counter: ${counter.label}${where}`);
    }
    totals[counter.key] = parseCounter(line.slice(counter.prefix.length), counter.label);
    seen[counter.key] = true;
  }
  if (!meaningful) return null;
  const where = sourceFile ? ` (${sourceFile})` : "";
  const missing = COUNTERS.filter((item) => !seen[item.key]).map((item) => item.label);
  if (missing.length > 0) {
    throw new Error(`coverage report missing counters: ${missing.join(", ")}${where}`);
  }
  if (totals.linesHit > totals.linesFound || totals.functionsHit > totals.functionsFound) {
    throw new Error(`coverage report invalid: hit exceeds found${where}`);
  }
  return totals;
}

/**
 * @param {string} content
 * @returns {{ linesFound: number, linesHit: number, functionsFound: number, functionsHit: number }}
 */
export function parseLcovTotals(content) {
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("coverage report empty");
  }
  const totals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0 };
  /** @type {string[]} */
  let recordLines = [];
  let sawRecord = false;
  const flush = () => {
    const record = parseRecord(recordLines);
    recordLines = [];
    if (!record) return;
    sawRecord = true;
    totals.linesFound += record.linesFound;
    totals.linesHit += record.linesHit;
    totals.functionsFound += record.functionsFound;
    totals.functionsHit += record.functionsHit;
  };
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === "end_of_record") {
      flush();
      continue;
    }
    recordLines.push(line);
  }
  flush();
  if (!sawRecord) {
    throw new Error("coverage report empty");
  }
  return assertAggregate(totals);
}

/**
 * @param {Record<string, number | undefined>} totals
 * @param {string} key
 */
function counterValue(totals, key) {
  if (!Object.hasOwn(totals, key)) {
    throw new Error(`coverage report missing counters: ${key}`);
  }
  const value = totals[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`coverage report malformed: ${key}`);
  }
  if (value < 0) {
    throw new Error(`coverage report negative counter: ${key}`);
  }
  return value;
}

/**
 * @param {Record<string, number | undefined>} totals
 */
function assertAggregate(totals) {
  const linesFound = counterValue(totals, "linesFound");
  const linesHit = counterValue(totals, "linesHit");
  const functionsFound = counterValue(totals, "functionsFound");
  const functionsHit = counterValue(totals, "functionsHit");
  if (linesHit > linesFound || functionsHit > functionsFound) {
    throw new Error("coverage report invalid: hit exceeds found");
  }
  if (linesFound === 0 || functionsFound === 0) {
    throw new Error("coverage report invalid: aggregate found is zero");
  }
  return { linesFound, linesHit, functionsFound, functionsHit };
}

/**
 * @param {{ linesFound: number, linesHit: number, functionsFound: number, functionsHit: number }} totals
 * @param {number} [threshold]
 */
export function assertCoverageThreshold(totals, threshold = COVERAGE_THRESHOLD) {
  const aggregate = assertAggregate(totals);
  const lines = aggregate.linesHit / aggregate.linesFound;
  const functions = aggregate.functionsHit / aggregate.functionsFound;
  const failures = [];
  if (lines < threshold) failures.push(`lines ${(lines * 100).toFixed(2)}% < ${(threshold * 100).toFixed(2)}%`);
  if (functions < threshold) failures.push(`functions ${(functions * 100).toFixed(2)}% < ${(threshold * 100).toFixed(2)}%`);
  if (failures.length > 0) throw new Error(`coverage threshold failed: ${failures.join("; ")}`);
  return { lines, functions };
}

/**
 * @param {string} path
 * @param {number} [threshold]
 */
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
