import type { Metadata } from "next";
import {
  generateRankingPeriodMetadata,
  generateRankingPeriodStaticParams,
  RankingsPeriodPageView,
} from "@/app/_localized/ranking-detail";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateRankingPeriodStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; period: string }> }): Promise<Metadata> {
  const routeParams = await params;
  return generateRankingPeriodMetadata("en", routeParams);
}

export default async function RankingsPeriodPage({ params }: { params: Promise<{ year: string; period: string }> }) {
  const { year, period } = await params;
  return <RankingsPeriodPageView locale="en" year={year} period={period} />;
}
