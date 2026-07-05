import { createEnglishPage } from "@/app/_localized/page-adapter";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

const route = createEnglishPage<{ dimension: string; slug: string }>({
  generateMetadata: ({ locale, params }) => generateCategoryDetailMetadataForLocale(locale, params),
  render: ({ locale, params: { dimension, slug } }) => (
    <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={1} />
  ),
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
