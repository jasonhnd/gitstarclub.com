import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");

describe("header search placeholder", () => {
  test("fills the mobile row and only truncates overflowing placeholders with an ellipsis", () => {
    const source = readFileSync(join(root, "web/app/_explore/SearchBox.tsx"), "utf8");
    expect(source).toContain("header-search-input");
    expect(source).toContain("w-full min-w-0 flex-1");
    expect(source).toContain("sm:w-44 sm:flex-none lg:w-56");
    expect(source).not.toContain("w-20");
    expect(source).not.toContain("w-24");
    expect(source).toContain("placeholder:truncate");

    const css = readFileSync(join(root, "astro/src/styles/globals.css"), "utf8");
    expect(css).toContain(".header-search-input::placeholder");
    expect(css).toContain(".header-search-input::-webkit-input-placeholder");
    expect(css).toContain("text-overflow: ellipsis");
  });
});
