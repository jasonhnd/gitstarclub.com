import type { Metadata } from "next";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ dimension: string; slug: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, routeParams) => generateCategoryDetailMetadataForLocale(locale, routeParams));
}

export default async function CategoryDetailPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { dimension, slug }) => <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={1} />);
}
