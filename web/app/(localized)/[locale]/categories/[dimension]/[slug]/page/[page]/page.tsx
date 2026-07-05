import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { categoryPath } from "@/app/categories/category-page-data";
import { localizedPath } from "@/lib/i18n/routing";
import { parsePositivePage } from "@/lib/pagination";

type Params = Promise<{ locale: string; dimension: string; slug: string; page: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, routeParams) => generateCategoryDetailMetadataForLocale(locale, routeParams));
}

export default async function LocalizedCategoryDetailPagedPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale, { dimension, slug, page: rawPage }) => {
    const page = parsePositivePage(rawPage);
    if (!page) notFound();
    if (page === 1) permanentRedirect(localizedPath(locale, categoryPath(dimension, slug)));

    return <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={page} />;
  });
}
