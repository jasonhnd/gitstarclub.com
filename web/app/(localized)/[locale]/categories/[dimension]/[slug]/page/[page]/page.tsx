import { notFound, permanentRedirect } from "next/navigation";
import { createLocalizedPage } from "@/app/_localized/page-adapter";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { categoryPath } from "@/app/categories/category-page-data";
import { localizedPath } from "@/lib/i18n/routing";
import { parsePositivePage } from "@/lib/pagination";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

const route = createLocalizedPage<{ dimension: string; slug: string; page: string }>({
  generateMetadata: ({ locale, params }) => generateCategoryDetailMetadataForLocale(locale, params),
  render: ({ locale, params: { dimension, slug, page: rawPage } }) => {
    const page = parsePositivePage(rawPage);
    if (!page) notFound();
    if (page === 1) permanentRedirect(localizedPath(locale, categoryPath(dimension, slug)));

    return <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={page} />;
  },
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
