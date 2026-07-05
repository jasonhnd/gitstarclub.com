import { notFound } from "next/navigation";
import { isLocale, type Dict } from "@/lib/i18n";
import { NON_DEFAULT_LOCALES, type NonDefaultLocale } from "@/lib/i18n/routing";

export type LocaleParams = Promise<{ locale: string }>;

export function generateCoreLocaleStaticParams(): Array<{ locale: NonDefaultLocale }> {
  return NON_DEFAULT_LOCALES.map((locale) => ({ locale }));
}

export async function resolveRouteLocale(params: LocaleParams): Promise<NonDefaultLocale> {
  const { locale } = await params;
  return resolveLocaleSegment(locale);
}

export function resolveLocaleSegment(locale: string): NonDefaultLocale {
  if (!isLocale(locale) || locale === "en") notFound();
  return locale;
}

export function repositoryTableLabels(t: Dict) {
  return {
    caption: t.tables.repositoryRankings,
    rank: t.tables.rank,
    repository: t.tables.repository,
    language: t.tables.language,
    unknown: t.tables.unknown,
    starsGained: t.tables.starsGained,
    growthRatePercent: t.tables.growthRatePercent,
    tenKCrossingDay: t.tables.tenKCrossingDay,
    day: t.tables.day,
    totalStars: t.tables.totalStars,
    rowStarsAdded: t.tables.rowStarsAdded,
  };
}

export function organizationTableLabels(t: Dict) {
  return {
    caption: t.tables.organizationRankings,
    rank: t.tables.rank,
    owner: t.tables.owner,
    ownerType: t.tables.ownerType,
    unknown: t.tables.unknown,
    trackedRepositories: t.tables.trackedRepositories,
    totalStars: t.tables.totalStars,
  };
}
