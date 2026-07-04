import type { Metadata } from "next";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "../../../../_localized/categories";
import { resolveRouteLocale } from "../../../../_localized/routing";

type Params = Promise<{ locale: string; dimension: string; slug: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  const { dimension, slug } = await params;
  return generateCategoryDetailMetadataForLocale(locale, { dimension, slug });
}

export default async function LocalizedCategoryDetailPage({ params }: { params: Params }) {
  const locale = await resolveRouteLocale(params);
  const { dimension, slug } = await params;
  return <CategoryDetailPageView locale={locale} dimension={dimension} slug={slug} page={1} />;
}
