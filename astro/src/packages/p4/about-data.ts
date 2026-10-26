import type { AboutThisDataProps } from "../../components/AboutThisDataContent";
import type { Meta, OrgEntity } from "../../../../web/lib/contracts";
import type { Dict, Locale } from "../../lib/i18n";
import { localizedPath } from "../../lib/i18n";

/** Same origin the shared layout uses for canonical and Open Graph URLs. */
export const SITE_ORIGIN = "https://gitstarclub.com";

export function organizationPageTitle(title: string): string {
  return `${title} · GitStarClub`;
}

export function organizationCanonicalUrl(locale: Locale, canonicalPath: string, origin = SITE_ORIGIN): string {
  return new URL(localizedPath(locale, canonicalPath), origin).href;
}

/** Current totals (hero, capsule) and the history curve. Daily-history coverage is included only when this page shows those published days. */
export function organizationAboutData(input: {
  locale: Locale;
  dictionary: Dict;
  meta: Meta | null;
  releaseId: string | null;
  pageTitle: string;
  canonicalUrl: string;
  org: OrgEntity;
}): AboutThisDataProps[] {
  const shared = {
    locale: input.locale,
    dictionary: input.dictionary,
    meta: input.meta,
    releaseId: input.releaseId,
    pageTitle: input.pageTitle,
    canonicalUrl: input.canonicalUrl,
  };
  const provenance = input.org.curve.recent_daily.length > 0 ? input.org.curve.provenance : undefined;
  return [
    { ...shared, layer: "currentTotals" },
    { ...shared, layer: "historyCurve", ...(provenance ? { historyCoverage: { start: provenance.start, end_inclusive: provenance.end_inclusive } } : {}) },
  ];
}
