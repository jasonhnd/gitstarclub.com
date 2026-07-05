import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pageMeta } from "./seo";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

function restoreEnv(): void {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
}

describe("pageMeta", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://gitstarclub.test";
  });

  afterEach(() => {
    restoreEnv();
  });

  test("keeps default-locale callers unprefixed and emits the full alternate set", () => {
    const meta = pageMeta({
      title: "Rankings",
      description: "GitHub star rankings.",
      path: "/rankings",
    });
    const alternates = meta.alternates as { canonical: string; languages: Record<string, string> };
    const openGraph = meta.openGraph as { url: string; locale: string };

    expect(alternates.canonical).toBe("https://gitstarclub.test/rankings");
    expect(openGraph.url).toBe("https://gitstarclub.test/rankings");
    expect(openGraph.locale).toBe("en_US");
    expect(alternates.languages).toEqual({
      "x-default": "https://gitstarclub.test/rankings",
      en: "https://gitstarclub.test/rankings",
      ja: "https://gitstarclub.test/ja/rankings",
      "zh-CN": "https://gitstarclub.test/zh/rankings",
      "zh-TW": "https://gitstarclub.test/zh-TW/rankings",
      ko: "https://gitstarclub.test/ko/rankings",
      es: "https://gitstarclub.test/es/rankings",
      fr: "https://gitstarclub.test/fr/rankings",
    });
  });

  test("localizes canonical and emits the full hreflang alternate set", () => {
    const meta = pageMeta({
      title: "Classement",
      description: "Classement des etoiles GitHub.",
      path: "/rankings",
      locale: "fr",
    });
    const alternates = meta.alternates as { canonical: string; languages: Record<string, string> };
    const openGraph = meta.openGraph as { url: string; locale: string };

    expect(alternates.canonical).toBe("https://gitstarclub.test/fr/rankings");
    expect(openGraph.url).toBe("https://gitstarclub.test/fr/rankings");
    expect(openGraph.locale).toBe("fr_FR");
    expect(alternates.languages).toEqual({
      "x-default": "https://gitstarclub.test/rankings",
      en: "https://gitstarclub.test/rankings",
      ja: "https://gitstarclub.test/ja/rankings",
      "zh-CN": "https://gitstarclub.test/zh/rankings",
      "zh-TW": "https://gitstarclub.test/zh-TW/rankings",
      ko: "https://gitstarclub.test/ko/rankings",
      es: "https://gitstarclub.test/es/rankings",
      fr: "https://gitstarclub.test/fr/rankings",
    });
  });

  test("can suppress localized alternates for pages outside localized SEO", () => {
    const meta = pageMeta({
      title: "Compare",
      description: "Compare repositories.",
      path: "/compare",
      participatesInLocalizedSeo: false,
    });
    const alternates = meta.alternates as { canonical: string; languages?: Record<string, string> };

    expect(alternates.canonical).toBe("https://gitstarclub.test/compare");
    expect(alternates.languages).toBeUndefined();
  });
});
