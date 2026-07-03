import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as setLanguage } from "../../app/api/lang/route";
import { middleware } from "../../middleware";

function redirectFor(path: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(new URL(path, "https://gitstarclub.com"), {
    headers: {
      accept: "text/html",
      ...headers,
    },
  });
  const response = middleware(request);
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

describe("locale middleware redirects", () => {
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
  });

  test("does not redirect prefetches or non-document requests", () => {
    expect(redirectFor("/rankings", { cookie: "gsc_lang=ja", "next-router-prefetch": "1" })).toBeNull();
    expect(redirectFor("/rankings", { cookie: "gsc_lang=ja", accept: "application/json" })).toBeNull();
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
});
