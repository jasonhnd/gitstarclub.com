import { expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { budgetFailures, median, scriptSize, summarize, type PageSample } from "../scripts/perf-metrics";

test("JavaScript accounting uses UTF-8 decoded bytes and individual gzip streams", () => {
  const body = new TextEncoder().encode('console.log("\u2603");');
  expect(scriptSize("inline:0", body)).toEqual({ name: "inline:0", bytes: body.length, gzip: gzipSync(body, { level: 9 }).length });
});
test("per-page byte budgets reject even one byte; FCP allows declared local noise only", () => {
  const web = { bytes: 300, gzip: 100, fcp: 80 };
  expect(budgetFailures(web, web)).toEqual([]);
  expect(budgetFailures(web, { ...web, gzip: 101 })).toEqual(["gzip JS 101 > 100 bytes"]);
  expect(budgetFailures(web, { ...web, bytes: 301 })).toHaveLength(1);
  expect(budgetFailures(web, { ...web, fcp: 100 })).toEqual([]);
  expect(budgetFailures(web, { ...web, fcp: 101 })).toHaveLength(1);
  expect(budgetFailures({ ...web, fcp: 400 }, { ...web, fcp: 441 })).toHaveLength(1);
});
test("medians require at least five stable script inventories, never missing-script wins", () => {
  const sample: PageSample = { bytes: 10, gzip: 20, scripts: [{ name: "/a.js", bytes: 10, gzip: 20 }], islandScripts: 1, islandInstances: 2, fcp: 40, lcp: 60 };
  expect(median([50, 10, 20, 40, 30])).toBe(30);
  expect(median([40, 10, 20, 30])).toBe(25);
  expect(() => median([NaN])).toThrow();
  expect(() => summarize(Array(4).fill(sample))).toThrow("At least five");
  expect(summarize([10, 20, 30, 40, 500].map((fcp) => ({ ...sample, fcp }))).fcp).toBe(30);
  expect(() => summarize([sample, sample, sample, sample, { ...sample, scripts: [] }])).toThrow("inventory changed");
});
