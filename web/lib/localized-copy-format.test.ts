import { describe, expect, test } from "bun:test";
import { buildLocalizedCategoryIndexCapsule, buildLocalizedCategoryIndexFaqs } from "@/app/_localized/detail-copy";
import { fill, listLabels, rankValues } from "@/app/_localized/detail-copy/format";
import { DETAIL_TEXT, SEO_TEXT } from "@/app/_localized/detail-copy/tables";
import type { CategoryRegistry } from "@/lib/contracts";
import { LOCALES, type Locale } from "@/lib/i18n";

const asOf = "2026-06-24";
const expectedLists: Record<Locale, readonly string[]> = {
  en: ["", "A", "A and B", "A, B and C", "A, B, C and D"],
  ja: ["", "A", "A\u3001B", "A\u3001B\u3001C", "A\u3001B\u3001C\u3001D"],
  zh: ["", "A", "A\u3001B", "A\u3001B\u3001C", "A\u3001B\u3001C\u3001D"],
  "zh-TW": ["", "A", "A\u3001B", "A\u3001B\u3001C", "A\u3001B\u3001C\u3001D"],
  ko: ["", "A", "A \uBC0F B", "A, B \uBC0F C", "A, B, C \uBC0F D"],
  es: ["", "A", "A y B", "A, B y C", "A, B, C y D"],
  fr: ["", "A", "A et B", "A, B et C", "A, B, C et D"],
};

function registry(labels: readonly string[]): CategoryRegistry {
  const ids = ["language", "ecosystem", "domain", "maturity"] as const;
  return {
    rules_version: "2026-06-01",
    generated_at: "2026-06-24T12:00:00Z",
    dimensions: labels.map((label, i) => ({ id: ids[i], label, categories: [] })),
  };
}

describe("live localized copy formatting", () => {
  for (const [name, table] of Object.entries({ detail: DETAIL_TEXT, seo: SEO_TEXT })) {
    test(`${name} locale tables have the same keys`, () => {
      expect(Object.keys(table).sort()).toEqual([...LOCALES].sort());
      const keys = Object.keys(table.en).sort();
      for (const locale of LOCALES) {
        expect(Object.keys(table[locale]).sort(), locale).toEqual(keys);
        expect(Object.values(table[locale]).every((value) => value.length > 0), locale).toBe(true);
      }
    });
  }

  for (const locale of LOCALES) {
    test(`${locale} category builders format empty through four-item lists`, () => {
      for (let n = 0; n <= 4; n++) {
        const data = registry(["A", "B", "C", "D"].slice(0, n));
        const capsule = buildLocalizedCategoryIndexCapsule(locale, data, asOf);
        const faqs = buildLocalizedCategoryIndexFaqs(locale, data, asOf);
        const datelessFaqs = buildLocalizedCategoryIndexFaqs(locale, data, null);
        // Capsules preview three dimensions; FAQs list every available one.
        expect(capsule.text).toContain(expectedLists[locale][Math.min(n, 3)]);
        expect(faqs[1].answer).toContain(expectedLists[locale][n]);
        expect(datelessFaqs[1].answer).toBe(faqs[1].answer);
        expect(capsule.text).not.toMatch(/\{\w+\}/);
        expect(faqs.flatMap((item) => [item.question, item.answer]).join(" ")).not.toMatch(/\{\w+\}/);
        expect(capsule.source).toBe("GitStarClub");
        expect(capsule.asOf).toBe(asOf);
      }
    });
  }

  test("Korean category capsule and FAQ use Korean conjunctions with page labels", () => {
    const data = registry(["\uC5B8\uC5B4", "\uC0DD\uD0DC\uACC4", "\uB3C4\uBA54\uC778"]);
    const expected = "\uC5B8\uC5B4, \uC0DD\uD0DC\uACC4 \uBC0F \uB3C4\uBA54\uC778";
    expect(buildLocalizedCategoryIndexCapsule("ko", data, asOf).text).toContain(expected);
    expect(buildLocalizedCategoryIndexFaqs("ko", data, asOf)[1].answer).toContain(expected);
    expect(buildLocalizedCategoryIndexCapsule("ko", data, asOf).text).not.toContain(" and ");
  });

  test("list punctuation preserves label text and established non-Korean output", () => {
    expect(listLabels(["A, and B", "C", "D"], "en")).toBe("A, and B, C and D");
    expect(listLabels(["A", "Idioma"], "es")).toBe("A y Idioma");
    expect(listLabels(["A\u3001B", "C"], "zh-TW")).toBe("A\u3001B\u3001C");
  });

  test("shared templates retain zero values and unresolved placeholders", () => {
    expect(fill("{count} {missing}", { count: 0 })).toBe("0 {missing}");
    expect(fill("{repo}", { repo: "{count}" })).toBe("{count}");
  });

  test("shared ranking values preserve signs and missing-value defaults", () => {
    const row = { owner: "react", name: "react" };
    expect(rankValues(row, "en", { metric: "gained" })).toEqual({ repo: "react/react", period: "", value: "+0" });
    expect(rankValues({ ...row, gained: -1200 }, "en", { metric: "gained", period: "2026-W25" }).value).toBe("-1.2k");
    expect(rankValues({ ...row, gained: -0 }, "en", { metric: "gained" }).value).toBe("+0");
    expect(rankValues({ ...row, total: 246000 }, "en", { metric: "total" }).value).toBe("246.0k");
  });
});
