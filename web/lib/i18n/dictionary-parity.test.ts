import { describe, expect, test } from "bun:test";
import en from "./dictionaries/en";
import es from "./dictionaries/es";
import fr from "./dictionaries/fr";
import ja from "./dictionaries/ja";
import ko from "./dictionaries/ko";
import zhTw from "./dictionaries/zh-tw";
import zh from "./dictionaries/zh";
import type { Dict, Locale } from ".";

const dictionaries: Record<Locale, Dict> = { en, ja, zh, "zh-TW": zhTw, ko, es, fr };

describe("locale dictionary contract", () => {
  test("every locale has exact recursive key parity with English", () => {
    const expected = dictionaryKeyPaths(en);
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(dictionaryKeyPaths(dictionary), locale).toEqual(expected);
    }
  });

  test("new shared entity, period, empty-state, and ARIA copy is translated", () => {
    for (const locale of ["ja", "zh", "zh-TW", "ko", "es", "fr"] as const) {
      const dictionary = dictionaries[locale];
      expect(dictionary.repo.profileEyebrow, `${locale}.repo.profileEyebrow`).not.toBe(en.repo.profileEyebrow);
      expect(dictionary.repo.relatedEmpty, `${locale}.repo.relatedEmpty`).not.toBe(en.repo.relatedEmpty);
      expect(dictionary.repo.relatedByLanguage, `${locale}.repo.relatedByLanguage`).not.toBe(en.repo.relatedByLanguage);
      expect(dictionary.org.aggregateTrackedStars, `${locale}.org.aggregateTrackedStars`).not.toBe(en.org.aggregateTrackedStars);
      expect(dictionary.org.compareMembers, `${locale}.org.compareMembers`).not.toBe(en.org.compareMembers);
      expect(dictionary.org.categoryTags, `${locale}.org.categoryTags`).not.toBe(en.org.categoryTags);
      expect(dictionary.rankings.permanentArchive, `${locale}.rankings.permanentArchive`).not.toBe(en.rankings.permanentArchive);
      expect(dictionary.rankings.noMovement, `${locale}.rankings.noMovement`).not.toBe(en.rankings.noMovement);
      expect(dictionary.a11y.rankingPeriod, `${locale}.a11y.rankingPeriod`).not.toBe(en.a11y.rankingPeriod);
    }
  });
});

function dictionaryKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Unsupported dictionary value at ${prefix || "<root>"}`);
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => dictionaryKeyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}
