import { describe, expect, test } from "bun:test";
import { parsePositiveIntegerParam, safeInternalRedirectPath } from "./route-utils";

describe("parsePositiveIntegerParam", () => {
  test("accepts only positive integer ids", () => {
    expect(parsePositiveIntegerParam("42")).toBe(42);
    expect(parsePositiveIntegerParam(null)).toBeNull();
    expect(parsePositiveIntegerParam("0")).toBeNull();
    expect(parsePositiveIntegerParam("-1")).toBeNull();
    expect(parsePositiveIntegerParam("1.5")).toBeNull();
    expect(parsePositiveIntegerParam("abc")).toBeNull();
  });
});

describe("safeInternalRedirectPath", () => {
  test("keeps relative internal paths", () => {
    expect(safeInternalRedirectPath("/rankings/2024")).toBe("/rankings/2024");
  });

  test("falls back to root for open-redirect inputs", () => {
    expect(safeInternalRedirectPath(null)).toBe("/");
    expect(safeInternalRedirectPath("https://evil.example")).toBe("/");
    expect(safeInternalRedirectPath("//evil.example/path")).toBe("/");
    expect(safeInternalRedirectPath("rankings")).toBe("/");
  });
});
