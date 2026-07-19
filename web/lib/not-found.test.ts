import { describe, expect, test } from "bun:test";
import { NOT_FOUND_COPY } from "../app/_localized/not-found";
import { LOCALES } from "./i18n";

describe("localized not-found copy", () => {
  test("provides complete, non-English copy for all seven locales", () => {
    expect(Object.keys(NOT_FOUND_COPY)).toEqual([...LOCALES]);
    for (const locale of LOCALES) {
      const copy = NOT_FOUND_COPY[locale];
      expect(copy.eyebrow.length).toBeGreaterThan(0);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
      expect(copy.home.length).toBeGreaterThan(0);
      if (locale !== "en") expect(copy.title).not.toBe(NOT_FOUND_COPY.en.title);
    }
  });
});
