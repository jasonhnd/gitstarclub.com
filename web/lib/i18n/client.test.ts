// Unit tests for the PURE i18n logic that backs the client chrome provider.
//
// `client.tsx` is a "use client" React module: `I18nProvider`, `useDict`, `T`, etc.
// all require React rendering, and its two pure helpers — `readLocaleCookie` and
// `resolve` — are module-private (not exported). bun's runtime also has no `document`
// (see check below). So we:
//   - import & test the genuinely pure exports from `./index` directly
//     (isLocale, getDictionary, DEFAULT_LOCALE, LANG_COOKIE, en dictionary shape), and
//   - shim `globalThis.document.cookie` and replicate `readLocaleCookie` / `resolve`
//     VERBATIM from client.tsx so the cookie-parse regex + dotted-path resolver are
//     covered against the real LANG_COOKIE / isLocale / en values.
// If client.tsx's private helpers change, these replicas must be kept in sync.
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import en from "./dictionaries/en";
import { DEFAULT_LOCALE, LANG_COOKIE, getDictionary, isLocale, LOCALES, type Locale } from ".";

// --- Replicas of the module-private helpers in client.tsx (kept verbatim). -------
function readLocaleCookie(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return value && isLocale(value) ? value : DEFAULT_LOCALE;
}

function resolve(t: typeof en, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], t);
  return typeof value === "string" ? value : path;
}

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
        "home",
        "about",
        "year",
        "month",
        "week",
        "repo",
        "org",
        "rankings",
        "trending",
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

describe("resolve (dotted-path resolver, replicated from client.tsx)", () => {
  test("returns the leaf string for a valid dotted path", () => {
    expect(resolve(en, "nav.home")).toBe("Home");
    expect(resolve(en, "nav.trending")).toBe("Pulse"); // label differs from key on purpose
    expect(resolve(en, "footer.madeIn")).toBe("Made in Tokyo");
  });

  test("falls back to the path string for a missing key", () => {
    expect(resolve(en, "nav.missing")).toBe("nav.missing");
    expect(resolve(en, "does.not.exist")).toBe("does.not.exist");
  });

  test("falls back when the path resolves to a non-string (an object node)", () => {
    // `nav` is an object, not a leaf string → return the path unchanged.
    expect(resolve(en, "nav")).toBe("nav");
  });

  test("an empty path resolves to the root object → falls back to the path", () => {
    expect(resolve(en, "")).toBe("");
  });
});

describe("readLocaleCookie (cookie parse, replicated from client.tsx)", () => {
  const ORIGINAL_DOCUMENT = (globalThis as { document?: unknown }).document;

  beforeEach(() => {
    // Shim a minimal document with a writable `cookie` string.
    (globalThis as { document?: unknown }).document = { cookie: "" };
  });

  afterEach(() => {
    if (ORIGINAL_DOCUMENT === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = ORIGINAL_DOCUMENT;
  });

  test("returns DEFAULT_LOCALE when no cookie is present", () => {
    (globalThis as { document: { cookie: string } }).document.cookie = "";
    expect(readLocaleCookie()).toBe(DEFAULT_LOCALE);
  });

  test("reads a valid locale from the gsc_lang cookie", () => {
    (globalThis as { document: { cookie: string } }).document.cookie = `${LANG_COOKIE}=ja`;
    expect(readLocaleCookie()).toBe("ja");
  });

  test("parses gsc_lang when it is not the first cookie in the string", () => {
    (globalThis as { document: { cookie: string } }).document.cookie = `other=1; ${LANG_COOKIE}=fr; another=2`;
    expect(readLocaleCookie()).toBe("fr");
  });

  test("URL-decodes the cookie value before validating (zh-TW)", () => {
    // "zh-TW" has no special chars, but exercise the decode path with an encoded hyphen-free value.
    (globalThis as { document: { cookie: string } }).document.cookie = `${LANG_COOKIE}=${encodeURIComponent("zh-TW")}`;
    expect(readLocaleCookie()).toBe("zh-TW");
  });

  test("falls back to DEFAULT_LOCALE for an unsupported cookie value", () => {
    (globalThis as { document: { cookie: string } }).document.cookie = `${LANG_COOKIE}=de`;
    expect(readLocaleCookie()).toBe(DEFAULT_LOCALE);
  });
});
