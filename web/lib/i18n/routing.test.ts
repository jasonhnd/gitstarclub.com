import { describe, expect, test } from "bun:test";
import {
  HREFLANG_BY_LOCALE,
  OPEN_GRAPH_LOCALE_BY_LOCALE,
  RESERVED_LOCALIZED_TOP_LEVEL_ROUTES,
  classifyRoute,
  isLocalizedRoutePath,
  isRepoRoutePath,
  isReservedLocalizedTopLevelRoute,
  localizedPath,
  stripLocale,
  toBcp47Locale,
  toHreflang,
  toOpenGraphLocale,
} from "./routing";

describe("localizedPath", () => {
  test("keeps default-locale paths unprefixed", () => {
    expect(localizedPath("en", "/")).toBe("/");
    expect(localizedPath("en", "/rankings")).toBe("/rankings");
    expect(localizedPath("en", "rankings/2026/7")).toBe("/rankings/2026/7");
  });

  test("prefixes non-default locale paths", () => {
    expect(localizedPath("ja", "/rankings")).toBe("/ja/rankings");
    expect(localizedPath("fr", "/categories/language/typescript")).toBe("/fr/categories/language/typescript");
    expect(localizedPath("zh-TW", "/")).toBe("/zh-TW");
  });

  test("preserves query and hash suffixes", () => {
    expect(localizedPath("ja", "/compare?repos=facebook/react")).toBe("/ja/compare?repos=facebook/react");
    expect(localizedPath("en", "/rankings#month")).toBe("/rankings#month");
  });
});

describe("stripLocale", () => {
  test("defaults unprefixed paths to English", () => {
    expect(stripLocale("/")).toEqual({ locale: "en", path: "/" });
    expect(stripLocale("/rankings")).toEqual({ locale: "en", path: "/rankings" });
    expect(stripLocale("/facebook/react")).toEqual({ locale: "en", path: "/facebook/react" });
  });

  test("strips supported non-default locale prefixes", () => {
    expect(stripLocale("/ja")).toEqual({ locale: "ja", path: "/" });
    expect(stripLocale("/ja/")).toEqual({ locale: "ja", path: "/" });
    expect(stripLocale("/ja/rankings")).toEqual({ locale: "ja", path: "/rankings" });
    expect(stripLocale("/zh-TW/compare")).toEqual({ locale: "zh-TW", path: "/compare" });
    expect(stripLocale("/fr/facebook/react")).toEqual({ locale: "fr", path: "/facebook/react" });
  });

  test("does not guess unsupported or default locale-looking prefixes", () => {
    expect(stripLocale("/pt/rankings")).toEqual({ locale: "en", path: "/pt/rankings" });
    expect(stripLocale("/en/rankings")).toEqual({ locale: "en", path: "/en/rankings" });
  });
});

describe("locale metadata mappings", () => {
  test("maps supported locales to BCP-47 hreflang values", () => {
    expect(HREFLANG_BY_LOCALE).toEqual({
      en: "en",
      ja: "ja",
      zh: "zh-CN",
      "zh-TW": "zh-TW",
      ko: "ko",
      es: "es",
      fr: "fr",
    });
    expect(toHreflang("zh")).toBe("zh-CN");
    expect(toBcp47Locale("zh-TW")).toBe("zh-TW");
  });

  test("maps supported locales to Open Graph locale values", () => {
    expect(OPEN_GRAPH_LOCALE_BY_LOCALE).toEqual({
      en: "en_US",
      ja: "ja_JP",
      zh: "zh_CN",
      "zh-TW": "zh_TW",
      ko: "ko_KR",
      es: "es_ES",
      fr: "fr_FR",
    });
    expect(toOpenGraphLocale("en")).toBe("en_US");
    expect(toOpenGraphLocale("zh")).toBe("zh_CN");
  });
});

describe("reserved localized top-level routes", () => {
  test("covers localized public top-level routes", () => {
    expect(RESERVED_LOCALIZED_TOP_LEVEL_ROUTES).toEqual(["about", "categories", "compare", "o", "privacy", "pulse", "rankings"]);
    expect(isReservedLocalizedTopLevelRoute("rankings")).toBe(true);
    expect(isReservedLocalizedTopLevelRoute("categories")).toBe(true);
    expect(isReservedLocalizedTopLevelRoute("repo-curve")).toBe(false);
    expect(isReservedLocalizedTopLevelRoute("api")).toBe(false);
  });
});

describe("classifyRoute", () => {
  test("classifies root and localized root paths", () => {
    expect(classifyRoute("/")).toEqual({ kind: "root", locale: "en", path: "/" });
    expect(classifyRoute("/ja")).toEqual({ kind: "localized-root", locale: "ja", path: "/" });
    expect(classifyRoute("/zh-TW")).toEqual({ kind: "localized-root", locale: "zh-TW", path: "/" });
  });

  test("classifies default-locale prefixed paths for future normalization", () => {
    expect(classifyRoute("/en/rankings")).toEqual({
      kind: "default-locale-prefix",
      locale: "en",
      path: "/rankings",
      segments: ["rankings"],
    });
  });

  test("classifies unprefixed reserved routes", () => {
    expect(classifyRoute("/rankings/2026/7")).toEqual({
      kind: "reserved-route",
      locale: "en",
      path: "/rankings/2026/7",
      route: "rankings",
      segments: ["rankings", "2026", "7"],
    });
    expect(classifyRoute("/o/vercel")).toEqual({
      kind: "reserved-route",
      locale: "en",
      path: "/o/vercel",
      route: "o",
      segments: ["o", "vercel"],
    });
  });

  test("classifies localized reserved routes", () => {
    expect(classifyRoute("/fr/categories/language/typescript")).toEqual({
      kind: "localized-reserved-route",
      locale: "fr",
      path: "/categories/language/typescript",
      route: "categories",
      segments: ["categories", "language", "typescript"],
    });
    expect(classifyRoute("/zh-TW/o/vercel")).toEqual({
      kind: "localized-reserved-route",
      locale: "zh-TW",
      path: "/o/vercel",
      route: "o",
      segments: ["o", "vercel"],
    });
  });

  test("classifies two-segment repo paths", () => {
    expect(classifyRoute("/facebook/react")).toEqual({
      kind: "repo-route",
      locale: "en",
      path: "/facebook/react",
      owner: "facebook",
      name: "react",
    });
    expect(isRepoRoutePath("/facebook/react")).toBe(true);
  });

  test("classifies localized repo paths using three segments", () => {
    expect(classifyRoute("/ja/facebook/react")).toEqual({
      kind: "localized-repo-route",
      locale: "ja",
      path: "/facebook/react",
      owner: "facebook",
      name: "react",
    });
    expect(isLocalizedRoutePath("/ja/facebook/react")).toBe(true);
    expect(isRepoRoutePath("/ja/facebook/react")).toBe(true);
  });

  test("keeps locale-code owners as English repo routes when the repo name is not reserved", () => {
    expect(classifyRoute("/ja/some-repo")).toEqual({
      kind: "repo-route",
      locale: "en",
      path: "/ja/some-repo",
      owner: "ja",
      name: "some-repo",
    });
  });

  test("resolves the locale-owner plus reserved-repo collision as a localized route", () => {
    expect(classifyRoute("/ja/rankings")).toEqual({
      kind: "localized-reserved-route",
      locale: "ja",
      path: "/rankings",
      route: "rankings",
      segments: ["rankings"],
    });
    expect(isLocalizedRoutePath("/ja/rankings")).toBe(true);
    expect(isRepoRoutePath("/ja/rankings")).toBe(false);
  });
});
