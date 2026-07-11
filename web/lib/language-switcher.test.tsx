import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LanguageSwitcher } from "@/app/components/LanguageSwitcher";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

describe("LanguageSwitcher", () => {
  test.each([
    { locale: "zh" as Locale, canonicalPath: "/zh/pulse", canonical: "/pulse" },
    { locale: "en" as Locale, canonicalPath: "/", canonical: "/" },
  ])("routes every locale through the language preference endpoint from $canonicalPath", ({ locale, canonicalPath, canonical }) => {
    const html = renderToStaticMarkup(createElement(LanguageSwitcher, { locale, canonicalPath, label: "Language" }));
    const links = extractLinks(html);

    expect(links).toHaveLength(LOCALES.length);
    expect(links.map(({ href }) => href)).toEqual(
      LOCALES.map((language) => `/api/lang?lang=${encodeURIComponent(language)}&next=${encodeURIComponent(canonical)}`),
    );
    expect(links.every(({ rel }) => rel === "nofollow")).toBe(true);
    expect(links.some(({ href }) => href === canonical || LOCALES.some((language) => href === `/${language}${canonical}`))).toBe(false);
  });
});

function extractLinks(html: string): { href: string; rel: string | undefined }[] {
  return [...html.matchAll(/<a\b([^>]*)>/gi)].map(([, attributes]) => ({
    href: decodeHtml(attribute(attributes, "href") ?? ""),
    rel: attribute(attributes, "rel"),
  }));
}

function attribute(attributes: string, name: string): string | undefined {
  return new RegExp(`\\b${name}=["']([^"']*)["']`, "i").exec(attributes)?.[1];
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, "&");
}
