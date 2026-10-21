import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adaptCategoryView } from "../../src/packages/p3/view-plugin";

test("the package adapter preserves the complete view and locale copy while replacing only host dependencies", () => {
  const original = readFileSync(new URL("../../../web/app/_localized/categories.tsx", import.meta.url), "utf8");
  const adapted = adaptCategoryView(original);
  expect(adapted).not.toContain('<Chrome ');
  expect(adapted).toContain('from "@/lib/data"');
  expect(adapted).toContain('from "@/lib/categories/availability"');
  expect(adapted).not.toContain('from "next/navigation"');
  expect(adapted).toContain("?astro-p3");
  const body = original.slice(original.indexOf("const DIMENSION_LABELS:"));
  expect(adapted.slice(adapted.indexOf("const DIMENSION_LABELS:"))).toBe(body.replace(/^\s*<Chrome [^\n]+\/>\n/gm, "\n"));
});

test("P3 uses the single integration-owned published-reader timeout alias", () => {
  const config = readFileSync(new URL("../../astro.config.mjs", import.meta.url), "utf8");
  const aliases = config.split("\n").filter((line) => line.includes("fetch-timeout"));
  expect(aliases).toHaveLength(1);
  expect(aliases[0]).toContain("./src/lib/published-readers.ts");
  expect(adaptCategoryView('import { fetchWithTimeout } from "@/lib/fetch-timeout.mjs";'))
    .toBe('import { fetchWithTimeout } from "@/lib/fetch-timeout.mjs";');
});
