import { describe, expect, test } from "bun:test";
import { nextCompareSelection } from "./selection";

describe("nextCompareSelection", () => {
  test("toggles existing repos and respects the compare cap", () => {
    expect(nextCompareSelection(new Set(["owner/a"]), "owner/a")).toEqual(new Set());
    expect(nextCompareSelection(new Set(["owner/a"]), "owner/b", 2)).toEqual(new Set(["owner/a", "owner/b"]));
    expect(nextCompareSelection(new Set(["owner/a", "owner/b"]), "owner/c", 2)).toEqual(new Set(["owner/a", "owner/b"]));
  });
});
