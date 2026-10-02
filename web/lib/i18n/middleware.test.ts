import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as setLanguage } from "../../app/api/lang/route";
import { config, proxy, shouldIgnorePath } from "../../proxy";
import { LOCALES, type Locale } from "./locales";

function redirectFor(path: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL(path, "https://gitstarclub.com"), {
    headers: {
      accept: "text/html",
      ...headers,
    },
  });
  const response = proxy(request);
  const location = response.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return { status: response.status, path: `${url.pathname}${url.search}` };
}

function responseRedirectPath(response: Response): string {
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  const url = new URL(location as string);
  return `${url.pathname}${url.search}`;
}

describe("locale proxy redirects", () => {
  test("permanently strips default-locale prefixes", () => {
    expect(redirectFor("/en/rankings", { cookie: "gsc_lang=ja" })).toEqual({ status: 308, path: "/rankings" });
    expect(redirectFor("/en/rankings?period=month")).toEqual({ status: 308, path: "/rankings?period=month" });
  });

  test("redirects unprefixed page requests to the cookie locale", () => {
    expect(redirectFor("/rankings", { cookie: "gsc_lang=ja" })).toEqual({ status: 307, path: "/ja/rankings" });
    expect(redirectFor("/facebook/react?tab=readme", { cookie: "gsc_lang=fr" })).toEqual({
      status: 307,
      path: "/fr/facebook/react?tab=readme",
    });
    expect(redirectFor("/mrdoob/three.js", { cookie: "gsc_lang=ja" })).toEqual({
      status: 307,
      path: "/ja/mrdoob/three.js",
    });
    expect(redirectFor("/mozilla/pdf.worker.min.js", { cookie: "gsc_lang=ko" })).toEqual({
      status: 307,
      path: "/ko/mozilla/pdf.worker.min.js",
    });
  });

  test("uses Accept-Language only for root requests without a locale cookie", () => {
    expect(redirectFor("/", { "accept-language": "ko-KR,ko;q=0.9,en;q=0.8" })).toEqual({ status: 307, path: "/ko" });
    expect(redirectFor("/rankings", { "accept-language": "ko-KR,ko;q=0.9,en;q=0.8" })).toBeNull();
    expect(redirectFor("/", { "accept-language": "en-US,en;q=0.9,fr;q=0.8" })).toBeNull();
  });

  test("lets explicit non-default locale URLs win over preferences", () => {
    expect(redirectFor("/ja/facebook/react", { cookie: "gsc_lang=fr" })).toBeNull();
  });

  test("keeps unprefixed deep links English when no preference is present", () => {
    expect(redirectFor("/facebook/react")).toBeNull();
  });

  test("does not redirect ignored paths", () => {
    expect(redirectFor("/_next/static/chunks/app.js", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/api/lang?lang=fr", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/favicon.png", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/robots.txt", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/sitemap.xml", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/opengraph-image", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/search-index", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/repo-curve", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/cockpit", { cookie: "gsc_lang=zh" })).toBeNull();
    expect(redirectFor("/cockpit", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/manifest.webmanifest", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/llms.txt", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/sw.js", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/data/exports/v1/latest/manifest.json", { cookie: "gsc_lang=ja" })).toBeNull();
    expect(redirectFor("/.well-known/deployment", { cookie: "gsc_lang=ja" })).toBeNull();
  });

  test("does not redirect prefetches or non-document requests", () => {
    expect(redirectFor("/rankings", { cookie: "gsc_lang=ja", "next-router-prefetch": "1" })).toBeNull();
    expect(redirectFor("/rankings", { cookie: "gsc_lang=ja", accept: "application/json" })).toBeNull();
  });

  test("uses explicit framework, metadata, and public-asset exclusions", () => {
    expect(shouldIgnorePath("/cockpit")).toBe(true);
    expect(shouldIgnorePath("/mrdoob/three.js")).toBe(false);
    expect(shouldIgnorePath("/mozilla/pdf.worker.min.js")).toBe(false);
    expect(shouldIgnorePath("/favicon.svg")).toBe(true);
    expect(shouldIgnorePath("/manifest.webmanifest")).toBe(true);
    expect(shouldIgnorePath("/sitemap-ja.xml")).toBe(true);
    expect(shouldIgnorePath("/rankings/2026/opengraph-image")).toBe(true);
    expect(shouldIgnorePath("/_next/static/chunks/app.js")).toBe(true);
    expect(shouldIgnorePath("/api/lang")).toBe(true);
  });

  test("matcher excludes static and API traffic before the locale proxy runs", () => {
    const source = config.matcher[0];
    expect(source).toContain("api/");
    expect(source).toContain("_next/");
    expect(source).toContain("robots\\.txt");
    expect(source).toContain("search-index");
    expect(source).toContain("repo-curve");
  });
});

describe("/api/lang locale redirects", () => {
  test("sets the language cookie and redirects to the requested locale URL", () => {
    const response = setLanguage(new Request("https://gitstarclub.com/api/lang?lang=fr&next=/rankings"));
    expect(response.status).toBe(307);
    expect(responseRedirectPath(response)).toBe("/fr/rankings");
    expect(response.headers.get("set-cookie")).toContain("gsc_lang=fr");
  });

  test("normalizes localized next paths before applying the requested locale", () => {
    const response = setLanguage(new Request("https://gitstarclub.com/api/lang?lang=en&next=/fr/rankings"));
    expect(response.status).toBe(307);
    expect(responseRedirectPath(response)).toBe("/rankings");
    expect(response.headers.get("set-cookie")).toContain("gsc_lang=en");
  });

  test("never emits a cross-origin Location for hostile next values", () => {
    for (const next of ["/%5C%5Cevil.example/path", "/%255C%255Cevil.example/path", "//evil.example/path"]) {
      const response = setLanguage(
        new Request(`https://gitstarclub.com/api/lang?lang=en&next=${encodeURIComponent(next)}`),
      );
      const location = new URL(response.headers.get("location") as string);
      expect(location.origin).toBe("https://gitstarclub.com");
      expect(location.pathname).toBe("/");
    }
  });

  test("preserves query strings and hashes for valid internal navigation", () => {
    const next = "/rankings?period=month#top";
    const response = setLanguage(
      new Request(`https://gitstarclub.com/api/lang?lang=fr&next=${encodeURIComponent(next)}`),
    );
    expect(response.headers.get("location")).toBe("https://gitstarclub.com/fr/rankings?period=month#top");
  });

  test("the confirmed /ja//example.com payload stays on the localized home", () => {
    const response = setLanguage(new Request("https://gitstarclub.com/api/lang?lang=en&next=/ja//example.com/path"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://gitstarclub.com/");
    expect(response.headers.get("set-cookie")).toContain("gsc_lang=en");

    const traditional = setLanguage(
      new Request("https://gitstarclub.com/api/lang?lang=zh-TW&next=/zh-TW///example.com/path"),
    );
    expect(traditional.status).toBe(307);
    expect(traditional.headers.get("location")).toBe("https://gitstarclub.com/zh-TW");
    expect(traditional.headers.get("set-cookie")).toContain("gsc_lang=zh-TW");
  });

  test("falls back to the localized home when stripping reveals an off-site path", () => {
    // Double and triple slashes, and percent-encoded slashes, pass the check
    // that runs before stripLocale. Dropping the post-strip call lets lang=en
    // redirect to example.com. Backslashes are rejected earlier and must still
    // land on the localized home.
    const prefixes = ["ja", "zh", "zh-TW", "ko", "es", "fr"] as const;
    for (const prefix of prefixes) {
      for (const next of hostileNextPaths(prefix)) {
        for (const lang of LOCALES) {
          const response = setLanguage(languageRequest(lang, next));
          const location = new URL(response.headers.get("location") as string);
          expect(location.origin).toBe("https://gitstarclub.com");
          expect(location.hostname).not.toBe("example.com");
          expect(location.pathname).toBe(localizedHome(lang));
          expect(location.search).toBe("");
          expect(location.hash).toBe("");
          expect(response.headers.get("set-cookie")).toContain(`gsc_lang=${lang}`);
        }
      }
    }
  });

  test("a default-locale /en prefix does not redirect off-site", () => {
    for (const next of hostileNextPaths("en")) {
      const response = setLanguage(languageRequest("fr", next));
      const location = new URL(response.headers.get("location") as string);
      expect(location.origin).toBe("https://gitstarclub.com");
      expect(location.hostname).not.toBe("example.com");
    }
  });

  test("keeps ordinary in-site navigation for every locale", () => {
    for (const lang of LOCALES) {
      const response = setLanguage(languageRequest(lang, "/rankings?period=month#top"));
      const path = lang === "en" ? "/rankings?period=month#top" : `/${lang}/rankings?period=month#top`;
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://gitstarclub.com${path}`);
      expect(response.headers.get("set-cookie")).toContain(`gsc_lang=${lang}`);
    }

    for (const prefix of ["ja", "zh", "zh-TW", "ko", "es", "fr"] as const) {
      const response = setLanguage(languageRequest("en", `/${prefix}/facebook/react`));
      expect(response.headers.get("location")).toBe("https://gitstarclub.com/facebook/react");
    }

    const switched = setLanguage(languageRequest("ja", "/zh-TW/rankings/2024?period=month#top"));
    expect(switched.headers.get("location")).toBe("https://gitstarclub.com/ja/rankings/2024?period=month#top");
  });
});

function languageRequest(lang: string, next: string): Request {
  return new Request(`https://gitstarclub.com/api/lang?lang=${encodeURIComponent(lang)}&next=${encodeURIComponent(next)}`);
}

function localizedHome(lang: Locale): string {
  return lang === "en" ? "/" : `/${lang}`;
}

function hostileNextPaths(prefix: string): string[] {
  return [
    `/${prefix}//example.com/path`,
    `/${prefix}///example.com/path`,
    `/${prefix}////example.com/path`,
    `/${prefix}/\\example.com/path`,
    `/${prefix}\\example.com/path`,
    `/${prefix}/%2f%2fexample.com/path`,
    `/${prefix}/%2F/%2Fexample.com/path`,
    `/${prefix}/%252f%252fexample.com/path`,
    `/${prefix}/%5c%5cexample.com/path`,
    `/${prefix}/%255c%255cexample.com/path`,
    `/${prefix}//user@example.com/path`,
    `/${prefix}///example.com/path?next=1#frag`,
  ];
}
