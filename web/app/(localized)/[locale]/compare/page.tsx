import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { ComparePageView, generateCompareMetadata } from "@/app/_localized/compare";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const dynamic = "force-static";
export const revalidate = false;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generateCompareMetadata(locale),
  render: ({ locale }) => <ComparePageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
