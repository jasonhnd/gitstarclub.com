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
  const origin = new URL("https://gitstarclub.com/api/lang");

  test("keeps relative internal paths", () => {
    expect(safeInternalRedirectPath("/rankings/2024", origin)).toBe("/rankings/2024");
    expect(safeInternalRedirectPath("/rankings?period=month#top", origin)).toBe("/rankings?period=month#top");
  });

  test("falls back to root for open-redirect inputs", () => {
    for (const value of [
      null,
      "https://evil.example",
      "https://user@evil.example/path",
      "//evil.example/path",
      "//user@evil.example/path",
      "/\\\\evil.example/path",
      "/%5C%5Cevil.example/path",
      "/%255c%255cevil.example/path",
      "/%2f%2fevil.example/path",
      "/%252f%252fevil.example/path",
      "/safe\\@evil.example",
      "/safe%5c@evil.example",
      "/safe\r\nLocation:%20https://evil.example",
      "/safe%0d%0aLocation:%20https://evil.example",
      "rankings",
    ]) {
      expect(safeInternalRedirectPath(value, origin)).toBe("/");
    }
  });

  test("requires the final WHATWG URL origin to match exactly", () => {
    expect(safeInternalRedirectPath("/repo", "https://gitstarclub.com:443/api/lang")).toBe("/repo");
    expect(safeInternalRedirectPath("/repo", "https://preview.gitstarclub.com/api/lang")).toBe("/repo");
  });
});
