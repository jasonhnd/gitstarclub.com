import { notFound, permanentRedirect } from "next/navigation";
import { createEnglishPage } from "@/app/_localized/page-adapter";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailPageStaticParams,
} from "@/app/_localized/categories";
import { categoryPath } from "@/app/categories/category-page-data";
import { parsePositivePage } from "@/lib/pagination";
import { LONG_TAIL_REVALIDATE_SECONDS } from "@/lib/data/publication-cache-contract";

export const dynamicParams = true;
export const revalidate = LONG_TAIL_REVALIDATE_SECONDS;

export async function generateStaticParams() {
  return generateCategoryDetailPageStaticParams();
}

const route = createEnglishPage<{ dimension: string; slug: string; page: string }>({
  generateMetadata: ({ locale, params }) => generateCategoryDetailMetadataForLocale(locale, params),
  render: ({ locale, params: { dimension, slug, page: rawPage } }) => {
    const page = parsePositivePage(rawPage);
    if (!page) notFound();
    if (page === 1) permanentRedirect(categoryPath(dimension, slug));

    return <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={page} />;
  },
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
