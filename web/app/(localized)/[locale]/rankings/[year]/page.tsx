import type { Metadata } from "next";
import {
  generateLocalizedRankingYearStaticParams,
  generateRankingYearMetadata,
  RankingsYearPageView,
} from "@/app/_localized/ranking-detail";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ locale: string; year: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedRankingYearStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, { year }) => generateRankingYearMetadata(locale, year));
}

export default async function LocalizedRankingsYearPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale, { year }) => <RankingsYearPageView locale={locale} year={year} />);
}
