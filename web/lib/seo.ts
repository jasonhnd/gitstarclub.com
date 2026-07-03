import type { Metadata } from "next";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { localizedPath, NON_DEFAULT_LOCALES, toHreflang, toOpenGraphLocale } from "@/lib/i18n/routing";
import { absoluteCanonicalUrl, siteBaseUrl } from "@/lib/sitemap";

export function pageMeta(opts: {
  title: string;
  description: string;
  /** Canonical path without a locale prefix. The helper owns locale prefixing. */
  path: string;
  locale?: Locale;
  absoluteTitle?: boolean;
  participatesInLocalizedSeo?: boolean;
  /** og/twitter image URL. Defaults to the site OG card; setting `openGraph` here would
   *  otherwise suppress the file-convention opengraph-image, so pass a route's own
   *  `<route>/opengraph-image` to keep its custom card (resolved absolute via metadataBase). */
  ogImage?: string;
}): Metadata {
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const canonicalPath = localizedPath(locale, opts.path);
  const canonicalUrl = absoluteCanonicalUrl(canonicalPath);
  const images = [{ url: opts.ogImage ?? "/opengraph-image" }];
  const languages = opts.participatesInLocalizedSeo === false ? undefined : localizedSeoLanguages(opts.path);

  return {
    title: opts.absoluteTitle ? { absolute: opts.title } : opts.title,
    description: opts.description,
    alternates: languages ? { canonical: canonicalUrl, languages } : { canonical: canonicalUrl },
    openGraph: { url: canonicalUrl, title: opts.title, description: opts.description, locale: toOpenGraphLocale(locale), images },
    twitter: { card: "summary_large_image", title: opts.title, description: opts.description, images },
  };
}

function localizedSeoLanguages(canonicalPath: string): Record<string, string> {
  const base = siteBaseUrl();
  const englishUrl = absoluteCanonicalUrl(localizedPath(DEFAULT_LOCALE, canonicalPath), base);
  const languages: Record<string, string> = {
    "x-default": englishUrl,
    [toHreflang(DEFAULT_LOCALE)]: englishUrl,
  };
  for (const locale of NON_DEFAULT_LOCALES) {
    languages[toHreflang(locale)] = absoluteCanonicalUrl(localizedPath(locale, canonicalPath), base);
  }
  return languages;
}
