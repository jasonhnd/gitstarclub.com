import type { Metadata } from "next";
import {
  generateRankingYearMetadata,
  generateRankingYearStaticParams,
  RankingsYearPageView,
} from "../../_localized/ranking-detail";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateRankingYearStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return generateRankingYearMetadata("en", year);
}

export default async function RankingsYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  return <RankingsYearPageView locale="en" year={year} />;
}
