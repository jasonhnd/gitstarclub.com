import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateLocalizedCategoryDimensionStaticParams,
} from "@/app/_localized/categories";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateLocalizedCategoryDimensionStaticParams();
}

const route = createLocalizedPage<{ dimension: string }>({
  generateMetadata: ({ locale, params: { dimension } }) => generateCategoryDimensionMetadata(locale, dimension),
  render: ({ locale, params: { dimension } }) => <CategoryDimensionPageView locale={locale} dimension={dimension} />,
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
