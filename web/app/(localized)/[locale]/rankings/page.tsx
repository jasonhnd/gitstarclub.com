import type { Metadata } from "next";
import { generateRankingsMetadata, RankingsPageView } from "@/app/_localized/rankings";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generateRankingsMetadata(locale));
}

export default async function LocalizedRankingsPage({ params }: { params: LocaleParams }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <RankingsPageView locale={locale} />);
}
