import type { Metadata } from "next";
import {
  generateLocalizedRankingPeriodStaticParams,
  generateRankingPeriodMetadata,
  RankingsPeriodPageView,
} from "@/app/_localized/ranking-detail";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ locale: string; year: string; period: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedRankingPeriodStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, routeParams) => generateRankingPeriodMetadata(locale, routeParams));
}

export default async function LocalizedRankingsPeriodPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale, { year, period }) => <RankingsPeriodPageView locale={locale} year={year} period={period} />);
}
