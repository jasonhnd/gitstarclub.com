import type { Metadata } from "next";
import {
  generateLocalizedRankingPeriodStaticParams,
  generateRankingPeriodMetadata,
  RankingsPeriodPageView,
} from "../../../../_localized/ranking-detail";
import { resolveRouteLocale } from "../../../../_localized/routing";

type Params = Promise<{ locale: string; year: string; period: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedRankingPeriodStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  const { year, period } = await params;
  return generateRankingPeriodMetadata(locale, { year, period });
}

export default async function LocalizedRankingsPeriodPage({ params }: { params: Params }) {
  const locale = await resolveRouteLocale(params);
  const { year, period } = await params;
  return <RankingsPeriodPageView locale={locale} year={year} period={period} />;
}
