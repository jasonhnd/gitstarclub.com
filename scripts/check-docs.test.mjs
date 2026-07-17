import { describe, expect, test } from "bun:test";
import {
  checkDocs,
  extractRepoReferences,
  historicalDocumentAllowlist,
} from "./check-docs.mjs";

describe("documentation consistency gate", () => {
  test("extracts current route-group paths and strips source line suffixes", () => {
    const markdown = [
      "Use `web/app/(en)/[locale]/[owner]/page.tsx:12`.",
      "Then run `bun web/scripts/validate-live-views.ts --bust 2026-07-17`.",
    ].join("\n");

    expect(extractRepoReferences(markdown)).toEqual([
      "web/app/(en)/[locale]/[owner]/page.tsx",
      "web/scripts/validate-live-views.ts",
    ]);
  });

  test("historical path exemptions are explicit and reasoned", () => {
    expect(historicalDocumentAllowlist.has("docs/CHANGELOG.md")).toBe(true);
    expect(historicalDocumentAllowlist.has("docs/analysis/DATA-CORRECTNESS-21.md")).toBe(true);
    for (const reason of historicalDocumentAllowlist.values()) {
      expect(reason.length).toBeGreaterThan(10);
    }
  });

  test("the checked-in repository satisfies all maintained doc contracts", () => {
    expect(checkDocs(process.cwd())).toEqual([]);
  });
});
