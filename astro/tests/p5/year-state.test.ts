import { expect, test } from "bun:test";
import { pulseYearRows } from "../../src/packages/p5/year-state";

test("Pulse hides saved year fragments when no annual ranking is published", () => {
  const firstDayFragments = [{ full_name: "example/fragment", gained: 1782 }];
  expect(pulseYearRows(true, firstDayFragments)).toEqual([]);
});

test("Pulse keeps rows when an annual ranking is published", () => {
  const annualRows = [{ full_name: "example/annual", gained: 12000 }];
  expect(pulseYearRows(false, annualRows)).toEqual(annualRows);
});
