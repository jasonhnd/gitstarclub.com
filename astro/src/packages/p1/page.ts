import { renderToStaticMarkup } from "react-dom/server";
import { isLocale, type Locale } from "../../../../web/lib/i18n";
import { withPublishedData } from "../../lib/published-fetch";
import { PageNotFound } from "../../lib/navigation";
import { generatePulseMetadata, PulsePageView } from "./pulse";
import { generateRankingsMetadata, RankingsPageView } from "./rankings";
import { generateRankingYearMetadata, generateRankingPeriodMetadata, RankingsYearPageView, RankingsPeriodPageView } from "./ranking-detail";

export type PageKind = "home" | "rankings" | "year" | "period";
export async function loadPage(kind: PageKind, localeValue = "en", year = "", period = "") {
  if (!isLocale(localeValue)) return null;
  const locale: Locale = localeValue;
  try {
    return await withPublishedData(async () => {
      const metadata = await (kind === "home" ? generatePulseMetadata({ locale, canonicalPath: "/", absoluteTitle: true })
        : kind === "rankings" ? generateRankingsMetadata(locale)
        : kind === "year" ? generateRankingYearMetadata(locale, year) : generateRankingPeriodMetadata(locale, { year, period }));
      const body = await (kind === "home" ? PulsePageView({ locale, canonicalPath: "/", includeWebsiteLd: true })
        : kind === "rankings" ? RankingsPageView({ locale })
        : kind === "year" ? RankingsYearPageView({ locale, year }) : RankingsPeriodPageView({ locale, year, period }));
      const canonical = new URL(String(metadata.alternates?.canonical));
      const prefix = locale === "en" ? "" : `/${locale}`;
      const canonicalPath = canonical.pathname.slice(prefix.length) || "/";
      const title = typeof metadata.title === "string" ? metadata.title : (metadata.title as { absolute: string }).absolute;
      const images = metadata.openGraph?.images as Array<{ url: string }>;
      return { locale, canonicalPath, title, description: String(metadata.description), ogImage: images[0].url,
        absoluteTitle: kind === "home", interactive: kind === "year" || kind === "period", html: renderToStaticMarkup(body) };
    });
  } catch (error) {
    if (error instanceof PageNotFound) return null;
    throw error;
  }
}
export type LoadedPage = NonNullable<Awaited<ReturnType<typeof loadPage>>>;
