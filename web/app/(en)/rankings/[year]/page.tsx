import type { Metadata } from "next";
import {
  generateRankingYearMetadata,
  generateRankingYearStaticParams,
  RankingsYearPageView,
} from "@/app/_localized/ranking-detail";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ year: string }>;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateRankingYearStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, { year }) => generateRankingYearMetadata(locale, year));
}

export default async function RankingsYearPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { year }) => <RankingsYearPageView locale={locale} year={year} />);
}
