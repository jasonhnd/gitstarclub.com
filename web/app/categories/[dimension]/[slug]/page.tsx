import type { Metadata } from "next";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "../../../_localized/categories";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ dimension: string; slug: string }> }): Promise<Metadata> {
  return generateCategoryDetailMetadataForLocale("en", await params);
}

export default async function CategoryDetailPage({ params }: { params: Promise<{ dimension: string; slug: string }> }) {
  const { dimension, slug } = await params;
  return <CategoryDetailPageView locale="en" dimension={dimension} slug={slug} page={1} />;
}
