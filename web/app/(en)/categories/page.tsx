import { createEnglishPage } from "@/app/_localized/page-adapter";
import { CategoriesPageView, generateCategoriesMetadata } from "@/app/_localized/categories";

export const revalidate = 86400;

const route = createEnglishPage({
  generateMetadata: ({ locale }) => generateCategoriesMetadata(locale),
  render: ({ locale }) => <CategoriesPageView locale={locale} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
