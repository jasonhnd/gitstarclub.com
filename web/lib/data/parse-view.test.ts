import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";
import {
  logViewParseErrorSummary,
  parseView,
  resetViewParseStateForTests,
  viewParseErrorFingerprint,
  viewParseErrorSummary,
} from "./parse-view";

const Doc = z.object({ ok: z.boolean(), tag: z.string() }).strict().describe("parse-view-doc");
const Other = z.object({ ok: z.boolean(), tag: z.string() }).strict().describe("parse-view-other");

describe("parseView", () => {
  test("parses once per path+version+schema and rethrows a cached ZodError without relogging", () => {
    resetViewParseStateForTests();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const json = { ok: true, tag: "one", extra: true };
      expect(() => parseView(json, Doc, { path: "meta.json", version: "v1" })).toThrow();
      expect(() => parseView(json, Doc, { path: "meta.json", version: "v1" })).toThrow();
      expect(() => parseView(json, Doc, { path: "meta.json", version: "v2" })).toThrow();
      expect(errorSpy.mock.calls).toHaveLength(2);
      expect(viewParseErrorSummary()).toEqual([
        expect.objectContaining({ path: "meta.json", version: "v1", count: 2 }),
        expect.objectContaining({ path: "meta.json", version: "v2", count: 1 }),
      ]);
    } finally {
      errorSpy.mockRestore();
      resetViewParseStateForTests();
    }
  });

  test("returns the same successful object without re-invoking the schema on cache hit", () => {
    resetViewParseStateForTests();
    const json = { ok: true, tag: "cached" };
    const first = parseView(json, Doc, { path: "ok.json", version: "v1" });
    const second = parseView({ ok: true, tag: "ignored-after-memo" }, Doc, { path: "ok.json", version: "v1" });
    expect(first).toEqual({ ok: true, tag: "cached" });
    expect(second).toBe(first);
    resetViewParseStateForTests();
  });

  test("does not share memo entries across schemas with different identities", () => {
    resetViewParseStateForTests();
    const json = { ok: true, tag: "x" };
    expect(parseView(json, Doc, { path: "doc.json", version: "v1" }).tag).toBe("x");
    expect(parseView(json, Other, { path: "doc.json", version: "v1" }).tag).toBe("x");
    resetViewParseStateForTests();
  });

  test("summarizes repeated fingerprints once at flush", () => {
    resetViewParseStateForTests();
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const json = { ok: true };
      expect(() => parseView(json, Doc, { path: "a.json", version: "v1" })).toThrow();
      expect(() => parseView(json, Doc, { path: "a.json", version: "v1" })).toThrow();
      logViewParseErrorSummary();
      const summaryLogs = errorSpy.mock.calls.filter((call) => String(call[0]).includes("repeated parse failures"));
      expect(summaryLogs).toHaveLength(1);
      expect(summaryLogs[0]?.[1]).toMatchObject({ path: "a.json", count: 2 });
    } finally {
      errorSpy.mockRestore();
      resetViewParseStateForTests();
    }
  });

  test("fingerprints unrecognized keys so lifecycle fields are visible", () => {
    const result = Doc.safeParse({ ok: true, tag: "x", active: true, tracked_since: null });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(viewParseErrorFingerprint(result.error)).toContain("unrecognized_keys");
    expect(viewParseErrorFingerprint(result.error)).toContain("active");
  });
});
