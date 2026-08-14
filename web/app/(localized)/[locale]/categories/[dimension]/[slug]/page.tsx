import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateLocalizedCategoryDetailStaticParams,
} from "@/app/_localized/categories";

export const dynamicParams = true;
export const revalidate = 604800;

export async function generateStaticParams() {
  return generateLocalizedCategoryDetailStaticParams();
}

const route = createLocalizedPage<{ dimension: string; slug: string }>({
  generateMetadata: ({ locale, params }) => generateCategoryDetailMetadataForLocale(locale, params),
  render: ({ locale, params: { dimension, slug } }) => (
    <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={1} />
  ),
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
