import { createEnglishPage } from "@/app/_localized/page-adapter";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateCategoryDimensionStaticParams,
} from "@/app/_localized/categories";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDimensionStaticParams();
}

const route = createEnglishPage<{ dimension: string }>({
  generateMetadata: ({ locale, params: { dimension } }) => generateCategoryDimensionMetadata(locale, dimension),
  render: ({ locale, params: { dimension } }) => <CategoryDimensionPageView locale={locale} dimension={dimension} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
