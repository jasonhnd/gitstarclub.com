import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateRankingsMetadata, RankingsPageView } from "@/app/_localized/rankings";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const revalidate = false;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generateRankingsMetadata(locale),
  render: ({ locale }) => <RankingsPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
