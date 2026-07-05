import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateRankingsMetadata, RankingsPageView } from "@/app/_localized/rankings";

export const revalidate = false;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generateRankingsMetadata(locale),
  render: ({ locale }) => <RankingsPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
