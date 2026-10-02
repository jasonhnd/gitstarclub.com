import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { fallbackRegistry } from "@/app/categories/category-page-data";
import {
  answerCapsuleLabels,
  buildLocalizedCategoryDetailCapsule,
  buildLocalizedCategoryDimensionCapsule,
  buildLocalizedCategoryIndexCapsule,
  buildLocalizedRankingCapsule,
} from "@/app/_localized/detail-copy";
import {
  buildLocalizedAllTimeRankingCapsule,
  buildLocalizedCompareCapsule,
  buildLocalizedPulseCapsule,
} from "@/app/_localized/seo-copy";
import type { CategoryRegistry } from "@/lib/contracts";
import { getDictionary, LOCALES, type Locale } from "@/lib/i18n";
import en from "@/lib/i18n/dictionaries/en";
import {
  capsuleWordCount,
  dataAsOfFromMeta,
  dataAsOfLabel,
  formatDataAsOf,
  resolveDataAsOfFromMeta,
  resolveDataAsOfLabel,
  resolveDataAsOfValue,
  visibleCapsuleSnapshot,
} from "./geo-capsules";

const asOf = dataAsOfLabel("2026-06-24T12:00:00Z");
const rankRows = [
  { owner: "react", name: "react", gained: 1200, total: 246000 },
  { owner: "vuejs", name: "vue", gained: 900, total: 208000 },
  { owner: "angular", name: "angular", gained: 700, total: 98000 },
];
const registry: CategoryRegistry = {
  rules_version: "2026-06-01",
  generated_at: "2026-06-24T12:00:00Z",
  dimensions: [
    {
      id: "language", label: "Languages", categories: [
        { id: "language/javascript", dimension: "language", slug: "javascript", label: "JavaScript", count: 214, public: true, sitemap: true, minimum_repo_count: 3 },
        { id: "language/python", dimension: "language", slug: "python", label: "Python", count: 175, public: true, sitemap: true, minimum_repo_count: 3 },
      ],
    },
    { id: "ecosystem", label: "Ecosystems", categories: [] },
    { id: "domain", label: "Domains", categories: [] },
  ],
};

function liveCapsules(locale: Locale, date = asOf, rows = rankRows) {
  return [
    buildLocalizedRankingCapsule({ locale, title: "June 2026 GitHub Star Rankings", asOf: date, rows, metric: "gained" }),
    buildLocalizedAllTimeRankingCapsule({ locale, asOf: date, repoRows: rows, orgRows: rows.length ? [{ login: "vercel", current_stars_sum: 400000, repo_count: 42 }] : [] }),
    buildLocalizedCategoryIndexCapsule(locale, registry, date),
    buildLocalizedCategoryDimensionCapsule(locale, registry.dimensions[0], date),
    buildLocalizedCategoryDetailCapsule({ locale, category: registry.dimensions[0].categories[0], asOf: date, rows }),
    buildLocalizedPulseCapsule({ locale, asOf: date, weekRows: rows, monthRows: rows.slice().reverse(), activeWeek: "2026-W25", activeMonth: "2026-06" }),
    buildLocalizedCompareCapsule(locale, date),
  ];
}

const visibleLabels = { answerCapsule: en.common.answerCapsule, dataAsOf: en.common.dataAsOf, source: en.common.source };

describe("shared GEO capsule dates and live localized builders", () => {
  test("formats data-as-of labels from real data fields", () => {
    expect(formatDataAsOf("2026-06-24T12:00:00Z")).toBe("June 24, 2026");
    expect(formatDataAsOf("2026-06-24")).toBe("June 24, 2026");
    expect(formatDataAsOf("2026-06")).toBe("June 2026");
    expect(formatDataAsOf("2026-W25")).toBe("2026 week 25");
    expect(formatDataAsOf("2026")).toBe("2026");
    expect(formatDataAsOf(null)).toBeNull();
    expect(formatDataAsOf("2026-06-28T12:00:00Z", "ja")).toBe("2026年6月28日");
    expect(formatDataAsOf("2026-06-28T12:00:00Z", "fr")).toBe("28 juin 2026");
    expect(resolveDataAsOfLabel("fallback", "2026-06-28T12:00:00Z", { locale: "ko" })).toBe("2026년 6월 28일");
    expect(dataAsOfFromMeta({ seam_date: "2020-01-01", schema_ver: 1, folded_through: { month: "2026-06", week: "2026-W25" } })).toBe("June 2026");
    expect(() => dataAsOfLabel("fallback")).toThrow("GEO answer capsule requires a real data-as-of date");
  });

  test("preserves raw date resolution and metadata candidate priority", () => {
    expect(resolveDataAsOfValue("fallback", "2026-06-24T12:00:00Z", "2026-06")).toBe("2026-06-24T12:00:00Z");
    expect(resolveDataAsOfValue(undefined, null, "fallback")).toBeNull();
    expect(resolveDataAsOfLabel("2026-06", "2026-06-24")).toBe("June 2026");
    expect(resolveDataAsOfFromMeta({ seam_date: "2020-01-01", schema_ver: 1, generated_at: "2026-06-24T12:00:00Z" }, "2026-07-01")).toBe(asOf);
    expect(resolveDataAsOfFromMeta(null, "2026-07-01")).toBe("July 1, 2026");
  });

  test("fallback category dates use a real secondary watermark without throwing", () => {
    const data = fallbackRegistry();
    expect(data.generated_at).toBe("fallback");
    expect(resolveDataAsOfLabel(data.generated_at, "2026-06-24T12:00:00Z")).toBe(asOf);
    expect(resolveDataAsOfLabel(data.generated_at)).toBeNull();
  });

  test("dateless metadata uses the optional capsule skip path", () => {
    const date = resolveDataAsOfFromMeta({ seam_date: "2020-01-01", schema_ver: 1 });
    expect(date).toBeNull();
    expect(date ? buildLocalizedCompareCapsule("en", date) : null).toBeNull();
  });

  test("word counting and visible snapshot helpers retain their contracts", () => {
    expect(capsuleWordCount("A/B — C")).toBe(3);
    expect(capsuleWordCount({ text: " A  B \n C " })).toBe(3);
    expect(capsuleWordCount("")).toBe(0);
    expect(visibleCapsuleSnapshot({ text: "Summary", asOf, source: "GitStarClub" }, visibleLabels)).toBe(
      `Answer capsule\nSummary\nData as of: ${asOf}\nSource: GitStarClub`,
    );
  });

  for (const locale of LOCALES) {
    test(`${locale} live capsules render dated and attributed HTML for populated and empty rows`, async () => {
      const t = await getDictionary(locale);
      const date = dataAsOfLabel("2026-06-24T12:00:00Z", { locale });
      for (const rows of [rankRows, rankRows.slice(0, 1), rankRows.slice(0, 2), []]) {
        for (const capsule of liveCapsules(locale, date, rows)) {
          const html = renderToStaticMarkup(createElement(AnswerCapsule, { capsule, labels: answerCapsuleLabels(locale, t) }));
          expect(capsule.asOf).toBe(date);
          expect(capsule.source).toBe("GitStarClub");
          expect(capsule.text).toContain(date);
          expect(capsule.text.endsWith(" - GitStarClub")).toBe(true);
          expect(capsule.text).not.toMatch(/\{\w+\}|\?repos=/);
          expect(html).toContain('data-testid="answer-capsule"');
          expect(html).toContain('data-testid="answer-capsule-data-as-of"');
          expect(html).toContain('data-testid="answer-capsule-source"');
        }
      }
    });
  }

  test("snapshots live English ranking and category capsule text", () => {
    expect(liveCapsules("en")[0].text).toBe(
      "As of June 24, 2026, June 2026 GitHub Star Rankings ranks tracked GitHub repositories by stars gained in the selected period. react/react leads with +1.2k stars, followed by vuejs/vue and angular/angular. GitStarClub generates this visible ranking from GitStarClub's precomputed ranking and repository data, without runtime search, a database, or AI. - GitStarClub",
    );
    expect(liveCapsules("en")[2].text).toBe(
      "As of June 24, 2026, browse 2 public GitHub categories across 3 dimensions, including Languages, Ecosystems and Domains. GitStarClub builds these category links from deterministic rules over repository metadata, not live search or AI, so readers can reach focused repository lists through crawlable pages. - GitStarClub",
    );
  });

  test("as-of labels reflect supplied metadata rather than hardcoded freshness", () => {
    const later = dataAsOfLabel("2026-07-02T09:00:00Z");
    for (const capsule of liveCapsules("en", later)) {
      expect(capsule.asOf).toBe(later);
      expect(capsule.text).toContain(later);
      expect(capsule.text).not.toContain(asOf);
    }
  });

  test("live compare capsule remains generic rather than describing client selections", () => {
    const capsule = buildLocalizedCompareCapsule("en", asOf);
    expect(capsule.text).toContain("without claiming client-only query-state facts as server-rendered evidence");
    expect(capsule.text).not.toMatch(/react\/react|vuejs\/vue|\?repos=|selected repositor/i);
  });
});
