import type { Metadata } from "next";
import {
  CategoryDimensionPageView,
  generateCategoryDimensionMetadata,
  generateCategoryDimensionStaticParams,
} from "../../_localized/categories";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDimensionStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ dimension: string }> }): Promise<Metadata> {
  const { dimension } = await params;
  return generateCategoryDimensionMetadata("en", dimension);
}

export default async function CategoryDimensionPage({ params }: { params: Promise<{ dimension: string }> }) {
  const { dimension } = await params;
  return <CategoryDimensionPageView locale="en" dimension={dimension} />;
}
