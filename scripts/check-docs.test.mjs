import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  checkCjkProse,
  checkDocs,
  extractRepoReferences,
  historicalDocumentAllowlist,
  isCjkAllowlisted,
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
    assert.equal(historicalDocumentAllowlist.has("docs/analysis/RECONCILE-MAIN-PRE-2026-07-19.md"), true);
    for (const reason of historicalDocumentAllowlist.values()) {
      assert.ok(reason.length > 10);
    }
  });

  test("the checked-in repository satisfies all maintained doc contracts", () => {
    assert.deepEqual(checkDocs(process.cwd()), []);
  });

  test("cjk allowlist covers product locale paths and localized tests only", () => {
    assert.equal(isCjkAllowlisted("web/lib/i18n/dictionaries/zh.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/i18n/locales.ts"), true);
    assert.equal(isCjkAllowlisted("web/app/_localized/seo-copy.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/format.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/narrative.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/shareable-snippets.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/format.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/narrative.test.tsx"), true);
    assert.equal(isCjkAllowlisted("web/e2e/routing-security.spec.ts"), true);
    assert.equal(isCjkAllowlisted("docs/OPS.md"), false);
    assert.equal(isCjkAllowlisted("plans/README.md"), false);
    assert.equal(isCjkAllowlisted("AGENTS.md"), false);
    assert.equal(isCjkAllowlisted(".cursor/agents/backend-engineer.md"), false);
    assert.equal(isCjkAllowlisted(".grok/rules/pre-only.md"), false);
    assert.equal(isCjkAllowlisted("web/lib/contracts/common.ts"), false);
  });

  test("cjk prose check flags Han text in scanned roots and skips allowlisted files", () => {
    const root = mkdtempSync(join(tmpdir(), "gsc-cjk-"));
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, "plans"), { recursive: true });
      mkdirSync(join(root, "web/lib/i18n/dictionaries"), { recursive: true });
      const han = String.fromCodePoint(0x9700, 0x6c42);
      writeFileSync(join(root, "docs/bad.md"), `Hello\n${han}\n`);
      writeFileSync(join(root, "docs/locale.test.ts"), `// ${han}\n`);
      writeFileSync(join(root, "docs/ok.md"), "Hello\n");
      writeFileSync(join(root, "plans/ok.md"), "English only\n");
      writeFileSync(join(root, "AGENTS.md"), "English\n");
      writeFileSync(join(root, "web/lib/i18n/dictionaries/zh.ts"), `export const label = "${han}";\n`);
      assert.deepEqual(checkCjkProse(root), [
        "docs/bad.md:2 CJK text is not allowed outside product locale files",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
