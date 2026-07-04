import type { Metadata } from "next";
import {
  generateLocalizedRankingYearStaticParams,
  generateRankingYearMetadata,
  RankingsYearPageView,
} from "../../../_localized/ranking-detail";
import { resolveRouteLocale } from "../../../_localized/routing";

type Params = Promise<{ locale: string; year: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedRankingYearStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  const { year } = await params;
  return generateRankingYearMetadata(locale, year);
}

export default async function LocalizedRankingsYearPage({ params }: { params: Params }) {
  const locale = await resolveRouteLocale(params);
  const { year } = await params;
  return <RankingsYearPageView locale={locale} year={year} />;
}
