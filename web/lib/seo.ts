import type { Metadata } from "next";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";

// Per-page metadata. Language is an in-page preference, so canonical URLs do not carry locale
// prefixes and we intentionally do not emit hreflang alternates for the same URL.

export function pageMeta(opts: {
  title: string;
  description: string;
  path: string;
  locale?: Locale;
  absoluteTitle?: boolean;
}): Metadata {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const norm = opts.path === "/" ? "/" : opts.path;
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: {
      canonical: norm,
    },
    openGraph: { url: norm, title: opts.title, description: opts.description, locale },
  };
}
