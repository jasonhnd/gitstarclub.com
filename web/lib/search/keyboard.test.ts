import { describe, expect, test } from "bun:test";
import { initialSearchActiveIndex, nextSearchActiveIndex } from "./keyboard";

describe("search keyboard navigation", () => {
  test("uses -1 when there are no results", () => {
    expect(initialSearchActiveIndex(0)).toBe(-1);
    expect(nextSearchActiveIndex(0, 0, 1)).toBe(-1);
  });

  test("moves within result bounds", () => {
    expect(initialSearchActiveIndex(3)).toBe(0);
    expect(nextSearchActiveIndex(0, 3, 1)).toBe(1);
    expect(nextSearchActiveIndex(2, 3, 1)).toBe(2);
    expect(nextSearchActiveIndex(2, 3, -1)).toBe(1);
    expect(nextSearchActiveIndex(0, 3, -1)).toBe(0);
  });
});
