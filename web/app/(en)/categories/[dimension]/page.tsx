import type { Metadata } from "next";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateCategoryDimensionStaticParams,
} from "@/app/_localized/categories";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

type Params = Promise<{ dimension: string }>;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDimensionStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, { dimension }) => generateCategoryDimensionMetadata(locale, dimension));
}

export default async function CategoryDimensionPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), (locale, { dimension }) => <CategoryDimensionPageView locale={locale} dimension={dimension} />);
}
