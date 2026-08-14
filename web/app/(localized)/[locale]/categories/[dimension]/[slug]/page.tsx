import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateLocalizedCategoryDetailStaticParams,
} from "@/app/_localized/categories";

import { LONG_TAIL_REVALIDATE_SECONDS } from "@/lib/data/publication-cache-contract";

export const dynamicParams = true;
export const revalidate = LONG_TAIL_REVALIDATE_SECONDS;

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
