import type { Metadata } from "next";
import { localePrefix, type Locale } from "@/lib/i18n";

// Per-page metadata. `path` is the locale-LESS path (e.g. "/2024", "/"); canonical gets the
// locale prefix, and hreflang alternates point each language at its own URL + x-default=en.
// See docs/SEO.md §2 / §10.

export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  locale?: Locale;
  absoluteTitle?: boolean;
}): Metadata {
  const locale = opts.locale ?? "en";
  const norm = (loc: Locale) => {
    const p = localePrefix(loc) + (opts.path === "/" ? "" : opts.path);
    return p || "/";
  };
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: {
      canonical: norm(locale),
      languages: { en: norm("en"), ja: norm("ja"), zh: norm("zh"), "x-default": norm("en") },
    },
    openGraph: { url: norm(locale), title: opts.title, description: opts.description },
  };
}
