import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  checkCjkProse,
  checkDocs,
  checkMaintainedFacts,
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

  test("preserves maintained fact diagnostics in order without changing files", () => {
    const root = mkdtempSync(join(tmpdir(), "gsc-maintained-facts-"));
    const apiSources = [
      "web/app/api/health/route.ts",
      "web/app/sitemap-*.xml/route.ts",
      "web/app/robots.ts",
      "web/app/manifest.ts",
      "web/app/opengraph-image.tsx",
      "web/app/(en)/[locale]/[owner]/opengraph-image.tsx",
      "web/app/(en)/rankings/[year]/opengraph-image.tsx",
      "web/app/(en)/rankings/[year]/[period]/opengraph-image.tsx",
    ];
    const files = {
      "web/package.json": JSON.stringify({ dependencies: { next: "99.0.0" } }),
      "web/app/api/health/route.ts": "",
      "web/app/sitemap-users.xml/route.ts": "",
      "docs/FRONTEND.md": "Next.js 99.0.0",
      "docs/SEO.md": "Next.js 99.0.0",
      "docs/UIUX-ROUTE-INVENTORY.md": "---\nowner: route and source inventory\n---\n",
      "docs/API.md": apiSources.join("\n"),
      "README.md": "Cloudflare R2 (production still reads Vercel Blob until cutover; see docs)",
      "docs/OPS.md": "Local environment: `web/.env.local`",
      "docs/WORKFLOW.md": "verify / static, verify / production-build; preview-e2e is optional",
    };
    const writeFiles = () => {
      for (const [path, content] of Object.entries(files)) {
        const target = join(root, path);
        mkdirSync(join(target, ".."), { recursive: true });
        writeFileSync(target, content);
      }
    };
    try {
      writeFiles();
      assert.deepEqual(checkMaintainedFacts(root), []);
      files["docs/FRONTEND.md"] = "outdated version";
      files["docs/SEO.md"] = "outdated version";
      files["docs/UIUX-ROUTE-INVENTORY.md"] = "no inventory owner";
      files["docs/API.md"] = "no endpoints";
      files["README.md"] = "outdated storage";
      files["docs/OPS.md"] = "\u672c\u5730\u7528 `.env`";
      files["docs/WORKFLOW.md"] = "outdated merge gates";
      files["docs/STALE.md"] = "Preview discovery for Vercel (required gates)\n\u5df2\u63d0\u4ea4\u5e76\u5f3a\u5236 preview-e2e\nweb/middleware.ts";
      writeFiles();
      const expected = [
        "docs/FRONTEND.md: expected Next.js 99.0.0",
        "docs/SEO.md: expected Next.js 99.0.0",
        "route/source inventory must have exactly one owner; found: none",
        ...apiSources.map((source) => `docs/API.md: endpoint inventory is missing ${source}`),
        "README.md: storage must be Cloudflare R2, with production still reading Vercel Blob until cutover",
        "docs/OPS.md: local env location must be web/.env.local",
        "docs/OPS.md: root .env is not loaded by the web scripts",
        "docs/WORKFLOW.md: merge gates must state GitHub required checks are static + production-build",
        "docs/WORKFLOW.md: merge gates must state preview-e2e / product-gates are optional",
        "docs/STALE.md: Vercel preview discovery is optional / skippable, not a required gate",
        "docs/STALE.md: preview-e2e suites are soft / optional, not enforced merge gates",
        "docs/STALE.md: stale middleware path; the active entrypoint is web/proxy.ts",
      ];
      assert.deepEqual(checkMaintainedFacts(root), expected);
      assert.deepEqual(checkMaintainedFacts(root), expected);
      for (const [path, content] of Object.entries(files)) {
        assert.equal(readFileSync(join(root, path), "utf8"), content);
      }
      // Historical records must remain exempt from current-state wording checks.
      files["docs/CHANGELOG.md"] = files["docs/STALE.md"];
      files["docs/STALE.md"] = "current wording";
      writeFiles();
      assert.deepEqual(checkMaintainedFacts(root), expected.slice(0, -3));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cjk allowlist covers product locale paths and localized tests only", () => {
    assert.equal(isCjkAllowlisted("web/lib/i18n/dictionaries/zh.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/i18n/locales.ts"), true);
    assert.equal(isCjkAllowlisted("web/app/_localized/seo-copy.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/format.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/narrative.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/shareable-snippets.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/format.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/narrative.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/shareable-snippets.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/geo-capsules.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/pulse-board-links.test.tsx"), true);
    assert.equal(isCjkAllowlisted("web/lib/rank-period-labels.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/rankings-archive.test.ts"), true);
    assert.equal(isCjkAllowlisted("web/e2e/routing-security.spec.ts"), true);
    assert.equal(isCjkAllowlisted("web/lib/narrative.test.tsx"), false);
    assert.equal(isCjkAllowlisted("web/lib/ordinary.test.ts"), false);
    assert.equal(isCjkAllowlisted("web/lib/ordinary.test.tsx"), false);
    assert.equal(isCjkAllowlisted("web/e2e/other.spec.ts"), false);
    assert.equal(isCjkAllowlisted("docs/OPS.md"), false);
    assert.equal(isCjkAllowlisted("plans/README.md"), false);
    assert.equal(isCjkAllowlisted("AGENTS.md"), false);
    assert.equal(isCjkAllowlisted(".cursor/agents/backend-engineer.md"), false);
    assert.equal(isCjkAllowlisted(".grok/rules/pre-only.md"), false);
    assert.equal(isCjkAllowlisted("web/lib/contracts/common.ts"), false);
  });

  test("repo reference scan still stops at full-width comma and semicolon", () => {
    const markdown = "See `web/lib/format.ts\uFF0Cweb/lib/narrative.ts\uFF1Bweb/lib/format.test.ts`.";
    assert.deepEqual(extractRepoReferences(markdown), [
      "web/lib/format.ts",
      "web/lib/narrative.ts",
      "web/lib/format.test.ts",
    ]);
  });

  test("cjk prose check flags full-width punctuation and a double em dash", () => {
    const root = mkdtempSync(join(tmpdir(), "gsc-cjk-punct-"));
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      const marks = [
        "\uFF0C",
        "\u3002",
        "\uFF1A",
        "\uFF1B",
        "\uFF08",
        "\uFF09",
        "\u300C",
        "\u300D",
        "\u2014\u2014",
        "\u3001",
        "\uFF01",
        "\uFF1F",
        "\u3010",
        "\u3011",
        "\u300A",
        "\u300B",
      ];
      const lines = [
        "ASCII only",
        ...marks.map((mark) => `note ${mark} here`),
        "spaced em dash \u2014 is allowed",
        "curly quotes \u201C\u201D\u2018\u2019 are allowed",
      ];
      writeFileSync(join(root, "docs/punct.md"), `${lines.join("\n")}\n`);
      assert.deepEqual(
        checkCjkProse(root),
        marks.map(
          (_, index) =>
            `docs/punct.md:${index + 2} CJK text is not allowed outside product locale files`,
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("cjk prose check flags Han text in scanned roots and skips allowlisted files", () => {
    const root = mkdtempSync(join(tmpdir(), "gsc-cjk-"));
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, "plans"), { recursive: true });
      mkdirSync(join(root, "web/lib/i18n/dictionaries"), { recursive: true });
      const han = String.fromCodePoint(0x9700, 0x6c42);
      writeFileSync(join(root, "docs/bad.md"), `Hello\n${han}\n`);
      writeFileSync(join(root, "docs/ordinary.test.ts"), `// ${han}\n`);
      writeFileSync(join(root, "docs/ok.md"), "Hello\n");
      writeFileSync(join(root, "plans/ok.md"), "English only\n");
      writeFileSync(join(root, "AGENTS.md"), "English\n");
      writeFileSync(join(root, "web/lib/i18n/dictionaries/zh.ts"), `export const label = "${han}";\n`);
      assert.deepEqual(checkCjkProse(root).sort(), [
        "docs/bad.md:2 CJK text is not allowed outside product locale files",
        "docs/ordinary.test.ts:1 CJK text is not allowed outside product locale files",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
