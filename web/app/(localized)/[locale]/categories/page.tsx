import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { CategoriesPageView, generateCategoriesMetadata } from "@/app/_localized/categories";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

export const revalidate = 86400;

export const generateStaticParams = generateCoreLocaleStaticParams;

const route = createLocalizedPage({
  generateMetadata: ({ locale }) => generateCategoriesMetadata(locale),
  render: ({ locale }) => <CategoriesPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
