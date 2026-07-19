import assert from "node:assert/strict";
import { describe, test } from "node:test";
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

    assert.deepEqual(extractRepoReferences(markdown), [
      "web/app/(en)/[locale]/[owner]/page.tsx",
      "web/scripts/validate-live-views.ts",
    ]);
  });

  test("historical path exemptions are explicit and reasoned", () => {
    assert.equal(historicalDocumentAllowlist.has("docs/CHANGELOG.md"), true);
    assert.equal(historicalDocumentAllowlist.has("docs/analysis/DATA-CORRECTNESS-21.md"), true);
    for (const reason of historicalDocumentAllowlist.values()) {
      assert.ok(reason.length > 10);
    }
  });

  test("the checked-in repository satisfies all maintained doc contracts", () => {
    assert.deepEqual(checkDocs(process.cwd()), []);
  });
});
