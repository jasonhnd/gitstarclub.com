import { describe, expect, test } from "bun:test";
import { corePublicationRevalidatePaths } from "./core-revalidate-paths";

describe("core publication revalidate paths", () => {
  test("covers default and localized catalog routes without repo long-tail", () => {
    const paths = corePublicationRevalidatePaths();
    expect(paths).toContain("/");
    expect(paths).toContain("/rankings");
    expect(paths).toContain("/ja/rankings");
    expect(paths).toContain("/zh-TW/about");
    expect(paths.every((path) => !path.includes("/facebook/"))).toBe(true);
    expect(paths.every((path) => !/\/o\/[^/]+$/.test(path))).toBe(true);
  });
});
