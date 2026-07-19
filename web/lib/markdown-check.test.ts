import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkMarkdownTree } from "../../scripts/check-markdown-code-fences.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gsc-markdown-check-"));
  roots.push(root);
  mkdirSync(join(root, "docs"));
  return root;
}

describe("Markdown and frontmatter gate", () => {
  test("accepts tagged fences and complete docs metadata", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "docs", "good.md"),
      [
        "---",
        "owner: maintainers",
        "status: active",
        "last_reviewed: 2026-07-17",
        "source_of_truth_for: test",
        "---",
        "```ts",
        "const ok = true;",
        "```",
      ].join("\n"),
    );
    expect(checkMarkdownTree(root)).toEqual({ codeFenceIssues: [], metadataIssues: [] });
  });

  test("rejects an untagged fence and missing frontmatter", () => {
    const root = fixtureRoot();
    writeFileSync(join(root, "docs", "bad.md"), "# Missing metadata\n\n```\nplain\n```\n");
    expect(checkMarkdownTree(root)).toEqual({
      codeFenceIssues: ["docs/bad.md:3"],
      metadataIssues: ["docs/bad.md:1 missing docs metadata frontmatter"],
    });
  });
});
