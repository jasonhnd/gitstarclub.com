import { localizedPath, type Locale } from "./i18n";

/** The exact canonical href and document title emitted by Layout. */
export function pageIdentity(locale: Locale, canonicalPath: string, title: string, absoluteTitle = false) {
  return {
    canonicalUrl: new URL(localizedPath(locale, canonicalPath), "https://gitstarclub.com").href,
    pageTitle: absoluteTitle ? title : `${title} · GitStarClub`,
  };
}
