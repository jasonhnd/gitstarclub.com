import { describe, expect, test } from "bun:test";
import { assertRuntimeVersions, expectedBunVersion } from "../../scripts/assert-runtime-versions.mjs";

describe("CI runtime contract", () => {
  test("accepts the repository's exact Node major and Bun pin", () => {
    expect(
      assertRuntimeVersions({
        expectedNodeMajor: "24",
        actualNodeVersion: "v24.4.1",
        expectedBun: "1.3.14",
        actualBun: "1.3.14",
      }),
    ).toEqual({ node: "v24.4.1", bun: "1.3.14" });
  });

  test("rejects controlled Node and Bun mismatches", () => {
    expect(() =>
      assertRuntimeVersions({
        expectedNodeMajor: "24",
        actualNodeVersion: "v22.18.0",
        expectedBun: "1.3.14",
        actualBun: "1.3.13",
      }),
    ).toThrow("Node major mismatch: expected 24.x, received v22.18.0; Bun mismatch: expected 1.3.14, received 1.3.13");
  });

  test("requires an exact Bun package-manager pin", () => {
    expect(expectedBunVersion("bun@1.3.14")).toBe("1.3.14");
    expect(() => expectedBunVersion("bun@^1.3.14")).toThrow("root packageManager must pin Bun exactly");
    expect(() => expectedBunVersion("npm@11")).toThrow("root packageManager must pin Bun exactly");
  });
});
