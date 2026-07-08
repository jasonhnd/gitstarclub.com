import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  generateLocalizedRankingPeriodStaticParams,
  generateRankingPeriodMetadata,
  RankingsPeriodPageView,
} from "@/app/_localized/ranking-detail";

export const dynamicParams = true;
export const revalidate = false;

export async function generateStaticParams() {
  return generateLocalizedRankingPeriodStaticParams();
}

const route = createLocalizedPage<{ year: string; period: string }>({
  generateMetadata: ({ locale, params }) => generateRankingPeriodMetadata(locale, params),
  render: ({ locale, params: { year, period } }) => <RankingsPeriodPageView locale={locale} year={year} period={period} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
