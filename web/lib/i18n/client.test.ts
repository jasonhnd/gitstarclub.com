// Unit tests for the pure i18n logic that backs static chrome text and prop-localized client islands.
// `client.tsx` stays server-safe and exports the deterministic chrome resolver; client-only hooks
// live in `client-runtime.tsx` as a route-dictionary fallback.
import { test, expect, describe } from "bun:test";
import en, { type Dict } from "./dictionaries/en";
import { DEFAULT_LOCALE, getDictionary, isLocale, LOCALES } from ".";
import { resolveChromePath } from "./client";

describe("isLocale (from ./index)", () => {
  test("accepts every declared locale", () => {
    for (const l of LOCALES) expect(isLocale(l)).toBe(true);
  });

  test("rejects unknown / malformed strings", () => {
    expect(isLocale("de")).toBe(false);
    expect(isLocale("EN")).toBe(false); // case-sensitive
    expect(isLocale("")).toBe(false);
    expect(isLocale("en-US")).toBe(false);
  });

  test("narrows the type so DEFAULT_LOCALE round-trips", () => {
    expect(isLocale(DEFAULT_LOCALE)).toBe(true);
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("getDictionary (from ./index)", () => {
  test("returns the in-module `en` object for the default locale", async () => {
    const dict = await getDictionary("en");
    expect(dict).toBe(en); // en loader returns the same reference
  });

  test("loads a non-default dictionary with the same key shape as en", async () => {
    const ja = await getDictionary("ja");
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
    expect(typeof ja.nav.home).toBe("string");
  });

  test("resolves a dictionary for every declared locale", async () => {
    for (const l of LOCALES) {
      const dict = await getDictionary(l);
      expect(typeof dict.footer.dataThrough).toBe("string");
    }
  });
});

describe("en dictionary shape (source of truth)", () => {
  test("has the expected top-level chrome sections", () => {
    expect(Object.keys(en)).toEqual(
      expect.arrayContaining([
        "nav",
        "about",
        "year",
        "month",
        "week",
        "repo",
        "org",
        "rankings",
        "pulse",
        "footer",
      ]),
    );
  });

  test("nav leaves are non-empty strings", () => {
    for (const v of Object.values(en.nav)) {
      expect(typeof v).toBe("string");
      expect((v as string).length).toBeGreaterThan(0);
    }
  });
});

describe("resolveChromePath (dotted-path resolver)", () => {
  test("returns the leaf string for a valid dotted path", () => {
    expect(resolveChromePath(en, "nav.home")).toBe("Home");
    expect(resolveChromePath(en, "nav.pulse")).toBe("Pulse");
    expect(resolveChromePath(en, "footer.madeIn")).toBe("Made in Tokyo");
  });

  test("falls back to the path string for a missing key", () => {
    expect(resolveChromePath(en, "nav.missing")).toBe("nav.missing");
    expect(resolveChromePath(en, "does.not.exist")).toBe("does.not.exist");
  });

  test("falls back to English before returning the path string", () => {
    const partial = { ...en, nav: { ...en.nav, pulse: undefined as unknown as string } } as Dict;
    expect(resolveChromePath(partial, "nav.pulse")).toBe(en.nav.pulse);
  });

  test("falls back when the path resolves to a non-string (an object node)", () => {
    // `nav` is an object, not a leaf string → return the path unchanged.
    expect(resolveChromePath(en, "nav")).toBe("nav");
  });

  test("an empty path resolves to the root object → falls back to the path", () => {
    expect(resolveChromePath(en, "")).toBe("");
  });
});
