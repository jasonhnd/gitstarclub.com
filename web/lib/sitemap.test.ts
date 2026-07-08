import { describe, expect, test } from "bun:test";
import {
  buildLocaleSitemapEntries,
  buildSitemapIndexEntries,
  buildSitemapIndexXml,
  buildSitemapPaths,
  buildSitemapXml,
  localizedAlternateUrls,
  localizedCanonicalUrl,
  localeSitemapPath,
  resolveSitemapLastModified,
  SITEMAP_FALLBACK_LAST_MODIFIED,
  sitemapChangeFrequency,
  sitemapLastModified,
  sitemapPriority,
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
      orgs: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`org-${index}`, {}])),
      categories: {
        dimensions: [
          {
            id: "language",
            categories: [
              { slug: "python", count: 250 },
              { slug: "rust", count: 40, sitemap: true },
              { slug: "unknown", count: 1000, sitemap: false },
            ],
          },
        ],
      },
    });

    expect(paths).toContain("");
    expect(paths).toContain("/pulse");
    expect(paths).toContain("/rankings");
    expect(paths).toContain("/categories");
    expect(paths).toContain("/categories/language");
    expect(paths).toContain("/categories/language/python");
    expect(paths).toContain("/categories/language/python/page/2");
    expect(paths).toContain("/categories/language/python/page/3");
    expect(paths).not.toContain("/categories/language/python/page/4");
    expect(paths).toContain("/categories/language/rust");
    expect(paths).not.toContain("/categories/language/unknown");
    expect(paths).not.toContain("/categories/language/unknown/page/2");
    expect(paths).toContain("/compare");
    expect(paths).toContain("/about");
    expect(paths).toContain("/rankings/2026");
    expect(paths).toContain("/rankings/2026/6");
    expect(paths).not.toContain("/rankings/2026/7");
    expect(paths).toContain("/rankings/2026/W23");
    expect(paths).not.toContain("/rankings/2026/W24");
    expect(paths).toContain("/vuejs/vue");
    expect(paths).toContain("/o");
    expect(paths).toContain("/o/page/2");
    expect(paths).toContain("/o/org-0");
  });

  test("does not enumerate future ISO-week years during a January previous-year ISO week", () => {
    const paths = buildSitemapPaths({ now: new Date("2027-01-01T12:00:00.000Z") });

    expect(paths).toContain("/rankings/2026/W53");
    expect(paths).not.toContain("/rankings/2027/W01");
  });

  test("uses folded-through metadata instead of the calendar for ranking periods", () => {
    const paths = buildSitemapPaths({
      now: new Date("2026-07-08T12:00:00.000Z"),
      meta: { folded_through: { month: "2026-06", week: "2026-W26" } },
    });

    expect(paths).toContain("/rankings/2026");
    expect(paths).toContain("/rankings/2025/12");
    expect(paths).toContain("/rankings/2026/6");
    expect(paths).not.toContain("/rankings/2026/7");
    expect(paths).toContain("/rankings/2026/W26");
    expect(paths).not.toContain("/rankings/2026/W28");
  });
});

describe("sitemap hints", () => {
  test("classifies crawl cadence and priority by path family", () => {
    expect(sitemapChangeFrequency("")).toBe("daily");
    expect(sitemapChangeFrequency("/o/page/2")).toBe("weekly");
    expect(sitemapChangeFrequency("/owner/repo")).toBe("monthly");
    expect(sitemapPriority("")).toBe(1);
    expect(sitemapPriority("/categories/language/python/page/2")).toBe(0.6);
    expect(sitemapPriority("/about")).toBe(0.4);
  });
});

describe("localized sitemap urls", () => {
  const base = "https://gitstarclub.test";
  const meta = { generated_at: "2026-06-04T12:00:00.000Z" };

  test("builds localized canonical URLs from canonical paths without locale prefixes", () => {
    expect(localizedCanonicalUrl("en", "/rankings", base)).toBe("https://gitstarclub.test/rankings");
    expect(localizedCanonicalUrl("ja", "/rankings", base)).toBe("https://gitstarclub.test/ja/rankings");
    expect(localizedCanonicalUrl("zh-TW", "", base)).toBe("https://gitstarclub.test/zh-TW");
  });

  test("builds the full hreflang alternate set with x-default pointing to English", () => {
    expect(localizedAlternateUrls("/rankings", base)).toEqual([
      { hreflang: "x-default", href: "https://gitstarclub.test/rankings" },
      { hreflang: "en", href: "https://gitstarclub.test/rankings" },
      { hreflang: "ja", href: "https://gitstarclub.test/ja/rankings" },
      { hreflang: "zh-CN", href: "https://gitstarclub.test/zh/rankings" },
      { hreflang: "zh-TW", href: "https://gitstarclub.test/zh-TW/rankings" },
      { hreflang: "ko", href: "https://gitstarclub.test/ko/rankings" },
      { hreflang: "es", href: "https://gitstarclub.test/es/rankings" },
      { hreflang: "fr", href: "https://gitstarclub.test/fr/rankings" },
    ]);
  });

  test("builds per-locale entries while keeping deterministic sitemap hints", () => {
    const entries = buildLocaleSitemapEntries("ja", ["", "/rankings/2024/6"], { meta, base });

    expect(entries[0].loc).toBe("https://gitstarclub.test/ja");
    expect(entries[0].priority).toBe(1);
    expect(entries[0].changeFrequency).toBe("daily");
    expect(entries[0].lastModified.toISOString()).toBe("2026-06-04T12:00:00.000Z");
    expect(entries[0].alternates).toContainEqual({ hreflang: "ja", href: "https://gitstarclub.test/ja" });
    expect(entries[0].alternates).toContainEqual({ hreflang: "x-default", href: "https://gitstarclub.test" });

    expect(entries[1].loc).toBe("https://gitstarclub.test/ja/rankings/2024/6");
    expect(entries[1].lastModified.toISOString()).toBe("2024-06-30T23:59:59.999Z");
  });

  test("builds sitemap index XML for all locale sitemap files", () => {
    const xml = buildSitemapIndexXml(buildSitemapIndexEntries(new Date("2026-06-04T12:00:00.000Z"), base));

    expect(localeSitemapPath("zh-TW")).toBe("/sitemap-zh-TW.xml");
    expect(xml).toContain("<sitemapindex");
    expect(xml.match(/<sitemap>/g)?.length).toBe(7);
    expect(xml).toContain("<loc>https://gitstarclub.test/sitemap-en.xml</loc>");
    expect(xml).toContain("<loc>https://gitstarclub.test/sitemap-zh-TW.xml</loc>");
    expect(xml).toContain("<lastmod>2026-06-04T12:00:00.000Z</lastmod>");
  });

  test("serializes per-locale sitemap XML with xhtml alternates", () => {
    const xml = buildSitemapXml(buildLocaleSitemapEntries("fr", ["/rankings"], { meta, base }));

    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain("<loc>https://gitstarclub.test/fr/rankings</loc>");
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="x-default" href="https://gitstarclub.test/rankings" />');
    expect(xml).toContain('<xhtml:link rel="alternate" hreflang="fr" href="https://gitstarclub.test/fr/rankings" />');
    expect(xml).toContain("<changefreq>daily</changefreq>");
    expect(xml).toContain("<priority>0.9</priority>");
  });
});

describe("sitemapLastModified", () => {
  const meta = { generated_at: "2026-06-04T12:00:00.000Z" };

  test("uses period end dates for historical ranking URLs, capped by the data snapshot", () => {
    expect(sitemapLastModified("/rankings/2024", { meta }).toISOString()).toBe("2024-12-31T23:59:59.999Z");
    expect(sitemapLastModified("/rankings/2024/10", { meta }).toISOString()).toBe("2024-10-31T23:59:59.999Z");
    expect(sitemapLastModified("/rankings/2026/W23", { meta }).toISOString()).toBe("2026-06-04T12:00:00.000Z");
  });

  test("uses category lookup generation time for category URLs", () => {
    expect(
      sitemapLastModified("/categories/language/python", {
        meta,
        categories: { generated_at: "2026-06-03T00:00:00.000Z", dimensions: [] },
      }).toISOString(),
    ).toBe("2026-06-03T00:00:00.000Z");
  });

  test("uses the data snapshot date for repo and org entity URLs", () => {
    expect(sitemapLastModified("/vuejs/vue", { meta }).toISOString()).toBe("2026-06-04T12:00:00.000Z");
    expect(sitemapLastModified("/o/vuejs", { meta }).toISOString()).toBe("2026-06-04T12:00:00.000Z");
  });
});
