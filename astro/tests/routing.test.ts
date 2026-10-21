import { describe, expect, test } from "bun:test";
import { NextRequest } from "../../web/node_modules/next/server";
import { proxy } from "../../web/proxy";
import { GET as legacyLanguage } from "../../web/app/api/lang/route";
import { LOCALES, localizedPath } from "../src/lib/i18n";
import { languageRedirect, negotiateLocale, pageRoute } from "../src/lib/routing";

describe("unchanged locale URLs", () => {
  for (const locale of LOCALES) {
    test(`${locale} resolves every shared page family`, () => {
      for (const path of ["/", "/pulse", "/rankings", "/rankings/2026", "/rankings/2026/7", "/rankings/2026/W27", "/categories", "/categories/language", "/categories/language/typescript", "/categories/language/typescript/page/2", "/o", "/o/page/2", "/o/example", "/example/repo", "/compare", "/about", "/privacy"]) {
        expect(pageRoute(localizedPath(locale, path))).toEqual({ locale, path });
      }
    });
    test(`${locale} language redirect agrees with the existing handler`, () => {
      for (const next of ["/", "/rankings/2026/W27?metric=flow#chart", "/ja/example/repo", "/zh-TW/categories/language/typescript/page/2"]) {
        const request = new Request(`https://site.example/api/lang?${new URLSearchParams({ lang: locale, next })}`);
        const actual = languageRedirect(request);
        const expected = legacyLanguage(request);
        expect(actual.status).toBe(expected.status);
        expect(actual.headers.get("location")).toBe(expected.headers.get("location"));
        expect(actual.headers.get("set-cookie")).toContain(`gsc_lang=${locale}`);
        for (const attr of ["Max-Age=31536000", "Path=/", "SameSite=Lax", "Secure"]) expect(actual.headers.get("set-cookie")).toContain(attr);
      }
    });
  }
  test("unsafe destinations keep the original same-origin protection", () => {
    for (const next of ["https://evil.example", "//evil.example", "/ja//evil.example", "/ja/%2f%2fevil.example", "/%252f%252fevil.example", "/\\evil.example", "/%0d%0aevil", "", "relative"]) {
      const request = new Request(`https://site.example/api/lang?${new URLSearchParams({ lang: "ja", next })}`);
      const response = languageRedirect(request);
      expect(response.headers.get("location")).toBe(legacyLanguage(request).headers.get("location"));
      expect(new URL(response.headers.get("location")!).origin).toBe("https://site.example");
    }
    expect(languageRedirect(new Request("https://site.example/api/lang?lang=invalid")).headers.get("location")).toBe("https://site.example/");
  });
  test("document negotiation matches web/proxy, including bypasses", () => {
    const cases: [string, Record<string, string>][] = [
      ["/en/example/repo?q=1", {}], ["/", { "accept-language": "ja-JP, en;q=0.5" }],
      ["/", { "accept-language": "zh-Hant;q=1,fr;q=.5" }], ["/", { "accept-language": "invalid;q=1,fr;q=.8" }],
      ["/", { "accept-language": "ja;q=0,en;q=.1" }], ["/pulse", { cookie: "gsc_lang=fr" }],
      ["/ja/pulse", { cookie: "gsc_lang=fr" }], ["/", { cookie: "gsc_lang=en", "accept-language": "ja" }],
      ["/search-index", { cookie: "gsc_lang=ja" }], ["/api/lang", { cookie: "gsc_lang=ja" }],
      ["/sitemap-fr.xml", { cookie: "gsc_lang=ja" }], ["/cockpit", { cookie: "gsc_lang=ja" }],
      ["/en/pulse", { purpose: "prefetch" }], ["/en/pulse", { "next-router-prefetch": "1" }],
      ["/en/pulse", { "sec-fetch-dest": "script" }],
    ];
    for (const [path, headers] of cases) {
      const request = new NextRequest(`https://site.example${path}`, { headers: { accept: "text/html", ...headers } });
      expect(negotiateLocale(request)?.headers.get("location") ?? null).toBe(proxy(request).headers.get("location"));
    }
  });
  test("control endpoints and unknown nested routes are not page fallbacks", () => {
    for (const path of ["/api/unknown", "/.well-known/deployment", "/de/example/repo", "/ja/cockpit", "/too/many/path/parts"]) expect(pageRoute(path)).toBeNull();
  });
});
