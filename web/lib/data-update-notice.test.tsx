import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_LOCALE, getDictionary, LOCALES, type Dict } from "@/lib/i18n";
import en from "@/lib/i18n/dictionaries/en";

mock.module("next/font/google", () => ({
  Plus_Jakarta_Sans: () => ({ variable: "font-sans" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}));

const { RootShell } = await import("@/app/_shell/RootShell");

function renderShell(dictionary?: Dict) {
  return renderToStaticMarkup(createElement(RootShell, {
    lang: DEFAULT_LOCALE, dictionary, children: createElement("main", { id: "main" }, "Synthetic page content"),
  }));
}

describe("data update notice", () => {
  test("appears exactly once before page content and after the skip link", () => {
    const html = renderShell();
    expect(html.match(/data-update-notice/g)).toHaveLength(1);
    expect(html.indexOf('href="#main"')).toBeLessThan(html.indexOf("data-update-notice"));
    expect(html.indexOf("data-update-notice")).toBeLessThan(html.indexOf('<main id="main"'));
    expect(html).toContain(en.common.dataUpdatesStopped);
  });

  test("renders the translated notice once for every supported locale", async () => {
    expect(LOCALES).toHaveLength(7);
    for (const locale of LOCALES) {
      const dictionary = await getDictionary(locale);
      const html = renderShell(dictionary);
      expect(html.match(/data-update-notice/g), locale).toHaveLength(1);
      expect(html, locale).toContain(dictionary.common.dataUpdatesStopped);
      expect(dictionary.common.dataUpdatesStopped.trim(), locale).not.toBe("");
      if (locale !== "en") expect(dictionary.common.dataUpdatesStopped, locale).not.toBe(en.common.dataUpdatesStopped);
    }
  });

  test("falls back to English when the notice translation is missing", () => {
    const partial = { ...en, common: { ...en.common, dataUpdatesStopped: undefined } } as unknown as Dict;
    expect(renderShell(partial)).toContain(en.common.dataUpdatesStopped);
  });
});
