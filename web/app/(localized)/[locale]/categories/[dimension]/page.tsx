import type { Metadata } from "next";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateLocalizedCategoryDimensionStaticParams,
} from "@/app/_localized/categories";
import { resolveRouteLocale } from "@/app/_localized/routing";

type Params = Promise<{ locale: string; dimension: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateLocalizedCategoryDimensionStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  const { dimension } = await params;
  return generateCategoryDimensionMetadata(locale, dimension);
}

export default async function LocalizedCategoryDimensionPage({ params }: { params: Params }) {
  const locale = await resolveRouteLocale(params);
  const { dimension } = await params;
  return <CategoryDimensionPageView locale={locale} dimension={dimension} />;
}
