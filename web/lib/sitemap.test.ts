import { describe, expect, test } from "bun:test";
import {
  buildSitemapPaths,
  resolveSitemapLastModified,
  SITEMAP_FALLBACK_LAST_MODIFIED,
  weeksInIsoYear,
} from "./sitemap";

describe("resolveSitemapLastModified", () => {
  test("uses bootstrap backfilled_at when present", () => {
    const date = resolveSitemapLastModified({
      backfilled_at: "2026-06-01T00:00:00.000Z",
      generated_at: "2026-06-02T00:00:00.000Z",
    });

    expect(date.toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  test("uses versioned generated_at when backfilled_at is absent", () => {
    const date = resolveSitemapLastModified({ generated_at: "2026-06-02T00:00:00.000Z" });

    expect(date.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });

  test("falls back to a stable fixed date when meta is absent", () => {
    const a = resolveSitemapLastModified(null);
    const b = resolveSitemapLastModified(undefined);

    expect(a.toISOString()).toBe(SITEMAP_FALLBACK_LAST_MODIFIED);
    expect(b.toISOString()).toBe(SITEMAP_FALLBACK_LAST_MODIFIED);
  });

  test("skips invalid timestamps before using generated_at or fallback", () => {
    expect(resolveSitemapLastModified({ backfilled_at: "invalid", generated_at: "2026-06-03T00:00:00.000Z" }).toISOString()).toBe(
      "2026-06-03T00:00:00.000Z",
    );
    expect(resolveSitemapLastModified({ backfilled_at: "invalid", generated_at: "also-invalid" }).toISOString()).toBe(SITEMAP_FALLBACK_LAST_MODIFIED);
  });
});

describe("weeksInIsoYear", () => {
  test("returns the real ISO week count for short and long ISO years", () => {
    expect(weeksInIsoYear(2025)).toBe(52);
    expect(weeksInIsoYear(2026)).toBe(53);
  });
});

describe("buildSitemapPaths", () => {
  test("includes core pages, compare, repos, orgs, months, and current weeks", () => {
    const paths = buildSitemapPaths({
      now: new Date("2026-06-04T12:00:00.000Z"),
      repos: { "1": { full_name: "vuejs/vue" } },
      orgs: { vercel: {} },
      categories: { dimensions: [{ id: "language", categories: [{ slug: "python" }, { slug: "rust", sitemap: true }, { slug: "unknown", sitemap: false }] }] },
    });

    expect(paths).toContain("");
    expect(paths).toContain("/pulse");
    expect(paths).toContain("/rankings");
    expect(paths).toContain("/categories");
    expect(paths).toContain("/categories/language");
    expect(paths).toContain("/categories/language/python");
    expect(paths).toContain("/categories/language/rust");
    expect(paths).not.toContain("/categories/language/unknown");
    expect(paths).toContain("/compare");
    expect(paths).toContain("/about");
    expect(paths).toContain("/rankings/2026");
    expect(paths).toContain("/rankings/2026/6");
    expect(paths).not.toContain("/rankings/2026/7");
    expect(paths).toContain("/rankings/2026/W23");
    expect(paths).not.toContain("/rankings/2026/W24");
    expect(paths).toContain("/vuejs/vue");
    expect(paths).toContain("/o/vercel");
  });

  test("does not enumerate future ISO-week years during a January previous-year ISO week", () => {
    const paths = buildSitemapPaths({ now: new Date("2027-01-01T12:00:00.000Z") });

    expect(paths).toContain("/rankings/2026/W53");
    expect(paths).not.toContain("/rankings/2027/W01");
  });
});
