import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  generateLocalizedRankingYearStaticParams,
  generateRankingYearMetadata,
  RankingsYearPageView,
} from "@/app/_localized/ranking-detail";

export const dynamicParams = true;
export const revalidate = false;

export async function generateStaticParams() {
  return generateLocalizedRankingYearStaticParams();
}

const route = createLocalizedPage<{ year: string }>({
  generateMetadata: ({ locale, params: { year } }) => generateRankingYearMetadata(locale, year),
  render: ({ locale, params: { year } }) => <RankingsYearPageView locale={locale} year={year} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
