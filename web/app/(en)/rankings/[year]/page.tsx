import { createEnglishPage } from "@/app/_localized/page-adapter";
import {
  generateRankingYearMetadata,
  generateRankingYearStaticParams,
  RankingsYearPageView,
} from "@/app/_localized/ranking-detail";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return generateRankingYearStaticParams();
}

const route = createEnglishPage<{ year: string }>({
  generateMetadata: ({ locale, params: { year } }) => generateRankingYearMetadata(locale, year),
  render: ({ locale, params: { year } }) => <RankingsYearPageView locale={locale} year={year} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
