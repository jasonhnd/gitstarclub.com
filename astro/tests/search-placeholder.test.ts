import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

describe("header search placeholder", () => {
  test("truncates with an ellipsis so narrow CJK placeholders are not cut mid-glyph", () => {
    const source = readFileSync(join(root, "web/app/_explore/SearchBox.tsx"), "utf8");
    expect(source).toContain("header-search-input");
    expect(source).toContain("placeholder:truncate");

    const css = readFileSync(join(root, "astro/src/styles/globals.css"), "utf8");
    expect(css).toContain(".header-search-input::placeholder");
    expect(css).toContain(".header-search-input::-webkit-input-placeholder");
    expect(css).toContain("text-overflow: ellipsis");
  });
});
