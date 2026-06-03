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
  /** og/twitter image URL. Defaults to the site OG card; setting `openGraph` here would
   *  otherwise suppress the file-convention opengraph-image, so pass a route's own
   *  `<route>/opengraph-image` to keep its custom card (resolved absolute via metadataBase). */
  ogImage?: string;
}): Metadata {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const norm = opts.path === "/" ? "/" : opts.path;
  const images = [{ url: opts.ogImage ?? "/opengraph-image" }];
  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: { canonical: norm },
    openGraph: { url: norm, title: opts.title, description: opts.description, locale, images },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description, images },
  };
}
