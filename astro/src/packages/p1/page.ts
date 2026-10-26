import { renderToStaticMarkup } from "react-dom/server";
import { isLocale, type Locale } from "../../../../web/lib/i18n";
import { localizedPath } from "../../../../web/lib/i18n/routing";
import { withPublishedReaders } from "../../lib/published-readers";
import { PageNotFound } from "../../lib/navigation";
import { generatePulseMetadata, PulsePageView } from "./pulse";
import { generateRankingsMetadata, RankingsPageView } from "./rankings";
import { generateRankingYearMetadata, generateRankingPeriodMetadata, RankingsYearPageView, RankingsPeriodPageView } from "./ranking-detail";

export function pageIdentity(locale: Locale, canonicalPath: string, title: string, absoluteTitle: boolean) {
  return {
    pageTitle: absoluteTitle ? title : `${title} · GitStarClub`,
    canonicalUrl: new URL(localizedPath(locale, canonicalPath), "https://gitstarclub.com").href,
  };
}

export type PageKind = "home" | "rankings" | "year" | "period";
export type PublishedData = Parameters<typeof withPublishedReaders>[0];
export async function loadPage(data: PublishedData, kind: PageKind, localeValue = "en", year = "", period = "") {
  if (!isLocale(localeValue)) return null;
  const locale: Locale = localeValue;
  try {
    return await withPublishedReaders(data, async () => {
      const metadata = await (kind === "home" ? generatePulseMetadata({ locale, canonicalPath: "/", absoluteTitle: true })
        : kind === "rankings" ? generateRankingsMetadata(locale)
        : kind === "year" ? generateRankingYearMetadata(locale, year) : generateRankingPeriodMetadata(locale, { year, period }));
      const canonical = new URL(String(metadata.alternates?.canonical));
      const title = typeof metadata.title === "string" ? metadata.title : (metadata.title as { absolute: string }).absolute;
      const prefix = locale === "en" ? "" : `/${locale}`;
      const canonicalPath = canonical.pathname.slice(prefix.length) || "/";
      const citation = pageIdentity(locale, canonicalPath, title, false);
      const rendered = await (kind === "home" ? PulsePageView({ locale, canonicalPath: "/", includeWebsiteLd: true, releaseId: data.publication.views?.version ?? null })
        : kind === "rankings" ? RankingsPageView({ locale, ...citation })
        : kind === "year" ? RankingsYearPageView({ locale, year, ...citation }) : RankingsPeriodPageView({ locale, year, period, ...citation }));
      const images = metadata.openGraph?.images as Array<{ url: string }>;
      return { locale, canonicalPath, title, description: String(metadata.description), ogImage: images[0].url, ogUrl: String(metadata.openGraph?.url),
        asOf: rendered.asOf, absoluteTitle: kind === "home", interactive: kind === "year" || kind === "period", aboutData: kind !== "home", html: renderToStaticMarkup(rendered.body) };
    });
  } catch (error) {
    if (error instanceof PageNotFound) return null;
    throw error;
  }
}
export type LoadedPage = NonNullable<Awaited<ReturnType<typeof loadPage>>>;
