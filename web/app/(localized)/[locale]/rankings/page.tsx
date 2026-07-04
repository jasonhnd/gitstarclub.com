import type { Metadata } from "next";
import { generateRankingsMetadata, RankingsPageView } from "@/app/_localized/rankings";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generateRankingsMetadata(locale);
}

export default async function LocalizedRankingsPage({ params }: { params: LocaleParams }) {
  const locale = await resolveRouteLocale(params);
  return <RankingsPageView locale={locale} />;
}
