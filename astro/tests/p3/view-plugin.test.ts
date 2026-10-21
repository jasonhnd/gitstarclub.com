import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { adaptCategoryView } from "../../src/packages/p3/view-plugin";

test("the package adapter preserves the complete view and locale copy while replacing only host dependencies", () => {
  const original = readFileSync(new URL("../../../web/app/_localized/categories.tsx", import.meta.url), "utf8");
  const adapted = adaptCategoryView(original);
  expect(adapted).not.toContain('<Chrome ');
  expect(adapted).not.toContain('from "@/lib/data"');
  expect(adapted).not.toContain('from "@/lib/categories/availability"');
  expect(adapted).not.toContain('from "next/navigation"');
  expect(adapted).toContain("?astro-p3");
  const body = original.slice(original.indexOf("const DIMENSION_LABELS:"));
  expect(adapted.slice(adapted.indexOf("const DIMENSION_LABELS:"))).toBe(body.replace(/^\s*<Chrome [^\n]+\/>\n/gm, "\n"));
});
