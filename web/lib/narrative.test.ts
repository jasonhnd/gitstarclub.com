import { describe, expect, test } from "bun:test";
import type { Locale } from "@/lib/i18n";
import { buildNarrative } from "./narrative";

const labels = {
  en: "June 2024",
  ja: "2024年6月",
  zh: "2024 年 6 月",
  "zh-TW": "2024 年 6 月",
  ko: "2024년 6월",
  es: "junio de 2024",
  fr: "juin 2024",
} satisfies Record<Locale, string>;

const base = {
  locale: "en" as Locale,
  label: labels.en,
  topGainers: [
    { full_name: "facebook/react", gained: 12345 },
    { full_name: "vuejs/vue", gained: 9000 },
    { full_name: "angular/angular", gained: 7000 },
  ],
  fastest: [{ full_name: "trending/x", rate: 320 }],
  newcomerCount: 5,
  newcomers: ["a/b", "c/d"],
};

describe("buildNarrative", () => {
  test("composes one factual paragraph for the selected locale", () => {
    const en = buildNarrative(base)!;
    expect(en).toBe(
      "In June 2024, facebook/react led GitHub with +12,345 stars, ahead of vuejs/vue and angular/angular. trending/x grew fastest, up 320%. 5 repositories first crossed 10,000 stars (e.g. a/b, c/d).",
    );

    const zh = buildNarrative({ ...base, locale: "zh", label: labels.zh })!;
    expect(zh).toBe(
      "2024 年 6 月，facebook/react 以 +12,345 星领涨，vuejs/vue、angular/angular 紧随其后。trending/x 增速最快，+320%。5 个项目首次突破 1 万星（如 a/b、c/d）。",
    );
    expect(buildNarrative({ ...base, locale: "ja", label: labels.ja })).toContain("2024年6月は、facebook/reactが+12,345スター");
    expect(buildNarrative({ ...base, locale: "ko", label: labels.ko })).toContain("2024년 6월에는 facebook/react");
    expect(buildNarrative({ ...base, locale: "es", label: labels.es })).toContain("En junio de 2024, facebook/react");

    const fr = buildNarrative({ ...base, locale: "fr", label: labels.fr })!;
    expect(fr).toContain("En juin 2024, facebook/react");
    expect(fr).toMatch(/\+12[\s\u202f]345 étoiles/);
  });

  test("returns null when there are no gainers", () => {
    expect(buildNarrative({ ...base, topGainers: [] })).toBeNull();
  });

  test("single gainer, no fastest, no newcomers → just the lead sentence", () => {
    const n = buildNarrative({
      locale: "en",
      label: "Jan 2020",
      topGainers: [{ full_name: "x/y", gained: 500 }],
      fastest: [],
      newcomerCount: 0,
      newcomers: [],
    })!;
    expect(n).toBe("In Jan 2020, x/y led GitHub with +500 stars.");

    const zh = buildNarrative({
      locale: "zh",
      label: "2020 年 1 月",
      topGainers: [{ full_name: "x/y", gained: 500 }],
      fastest: [],
      newcomerCount: 0,
      newcomers: [],
    })!;
    expect(zh).toBe("2020 年 1 月，x/y 以 +500 星领涨。");
  });

  test("singular newcomer wording", () => {
    const n = buildNarrative({ ...base, fastest: [], newcomerCount: 1, newcomers: ["solo/repo"] })!;
    expect(n).toContain("1 repository first crossed 10,000 stars (e.g. solo/repo).");
    expect(buildNarrative({ ...base, locale: "zh", label: labels.zh, fastest: [], newcomerCount: 1, newcomers: ["solo/repo"] })).toContain("1 个项目首次突破 1 万星（如 solo/repo）。");
  });
});
