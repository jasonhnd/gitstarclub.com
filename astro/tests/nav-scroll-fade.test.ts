import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("mobile navigation fade uses the header surface in both layers", () => {
  const root = join(import.meta.dir, "../..");
  const css = readFileSync(join(root, "web/app/globals.css"), "utf8");
  const rule = css.match(/\.nav-scroll-affordance\s*\{([^}]+)\}/)?.[1] ?? "";
  expect(rule.match(/var\(--md-sys-color-surface\)/g)).toHaveLength(2);
  expect(rule).not.toContain("--md-sys-color-primary-container");
  expect(css).toMatch(/@media \(min-width: 64rem\)\s*\{\s*\.nav-scroll-affordance\s*\{\s*background: none;/);
  const chrome = readFileSync(join(root, "astro/src/components/Chrome.astro"), "utf8");
  expect(chrome).toContain("bg-surface/80");
  expect(readFileSync(join(root, "astro/src/styles/globals.css"), "utf8")).toContain('@import "../../../web/app/globals.css"');
});
