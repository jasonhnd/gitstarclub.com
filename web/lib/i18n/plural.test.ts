import { describe, expect, test } from "bun:test";
import en from "./dictionaries/en";
import es from "./dictionaries/es";
import fr from "./dictionaries/fr";
import ja from "./dictionaries/ja";
import ko from "./dictionaries/ko";
import zhTw from "./dictionaries/zh-tw";
import zh from "./dictionaries/zh";
import { countWithNoun, plural } from "./plural";

const card = {
  en: { 0: "0 repositories", 1: "1 repository", 2: "2 repositories" },
  es: { 0: "0 repositorios", 1: "1 repositorio", 2: "2 repositorios" },
  fr: { 0: "0 dépôt", 1: "1 dépôt", 2: "2 dépôts" },
} as const;

describe("visible-row noun", () => {
  test("picks singular and plural for 0, 1, and 2 in English, Spanish, and French", () => {
    const forms = { en: en.rankings.repos, es: es.rankings.repos, fr: fr.rankings.repos };
    for (const locale of ["en", "es", "fr"] as const) {
      for (const count of [0, 1, 2] as const) {
        expect(countWithNoun(locale, count, forms[locale]), `${locale} ${count}`).toBe(card[locale][count]);
      }
    }
  });

  test("keeps one form in Japanese, Chinese, and Korean", () => {
    const dictionaries = { ja, zh, "zh-TW": zhTw, ko } as const;
    for (const locale of Object.keys(dictionaries) as Array<keyof typeof dictionaries>) {
      const forms = dictionaries[locale].rankings.repos;
      expect(forms.one, locale).toBe(forms.other);
      for (const count of [0, 1, 2]) {
        expect(countWithNoun(locale, count, forms), `${locale} ${count}`).toBe(`${count} ${forms.other}`);
      }
    }
  });

  test("uses the locale category even when both forms differ", () => {
    const forms = { one: "one-form", other: "other-form" };
    expect(plural("en", 0, forms)).toBe("other-form");
    expect(plural("en", 1, forms)).toBe("one-form");
    expect(plural("fr", 0, forms)).toBe("one-form");
    expect(plural("fr", 2, forms)).toBe("other-form");
    expect(plural("ja", 1, forms)).toBe("other-form");
    expect(plural("zh-TW", 1, forms)).toBe("other-form");
    // Second lookup hits the cached PluralRules instance.
    expect(plural("en", 2, forms)).toBe("other-form");
  });
});
