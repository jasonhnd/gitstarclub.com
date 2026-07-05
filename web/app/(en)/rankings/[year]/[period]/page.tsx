import type { Metadata } from "next";
import {
  generateRankingPeriodMetadata,
  generateRankingPeriodStaticParams,
  RankingsPeriodPageView,
} from "@/app/_localized/ranking-detail";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ year: string; period: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateRankingPeriodStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, routeParams) => generateRankingPeriodMetadata(locale, routeParams));
}

export default async function RankingsPeriodPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { year, period }) => <RankingsPeriodPageView locale={locale} year={year} period={period} />);
}
