import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSitemapPaths } from "../sitemap";
import { COCKPIT_PATH } from "./posed-frames";

const WEB_ROOT = join(import.meta.dir, "../..");

describe("cockpit isolation", () => {
  test("posed cockpit path is not a sitemap URL", () => {
    expect(COCKPIT_PATH).toBe("/cockpit");
    expect(buildSitemapPaths()).not.toContain("/cockpit");
  });

  test("chrome navigation list does not gain a Cockpit item", () => {
    const source = readFileSync(join(WEB_ROOT, "app/_explore/Chrome.tsx"), "utf8");
    expect(source).toContain('path: "/pulse"');
    expect(source).toContain('path: "/rankings"');
    expect(source).not.toMatch(/path:\s*"\/cockpit"/);
  });

  test("global tokens file is not the cockpit stylesheet", () => {
    const css = readFileSync(join(WEB_ROOT, "app/globals.css"), "utf8");
    expect(css.includes("cockpit")).toBe(false);
  });
});
