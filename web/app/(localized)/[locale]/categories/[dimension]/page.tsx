import type { Metadata } from "next";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateLocalizedCategoryDimensionStaticParams,
} from "@/app/_localized/categories";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ locale: string; dimension: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateLocalizedCategoryDimensionStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, { dimension }) => generateCategoryDimensionMetadata(locale, dimension));
}

export default async function LocalizedCategoryDimensionPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale, { dimension }) => <CategoryDimensionPageView locale={locale} dimension={dimension} />);
}
