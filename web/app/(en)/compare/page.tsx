import { createEnglishPage } from "@/app/_localized/page-adapter";
import { generateCompareMetadata, ComparePageView } from "@/app/_localized/compare";

export const dynamic = "force-static";
export const revalidate = false;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generateCompareMetadata(locale),
  render: ({ locale }) => <ComparePageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
