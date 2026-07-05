import type { Metadata } from "next";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ locale: string; dimension: string; slug: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, routeParams) => generateCategoryDetailMetadataForLocale(locale, routeParams));
}

export default async function LocalizedCategoryDetailPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale, { dimension, slug }) => <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={1} />);
}
