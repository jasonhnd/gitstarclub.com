import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  CategoryDetailPageView,
  generateCategoryDetailMetadataForLocale,
  generateCategoryDetailStaticParams,
} from "@/app/_localized/categories";
import { categoryPath } from "@/app/categories/category-page-data";
import { parsePositivePage } from "@/lib/pagination";

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return generateCategoryDetailStaticParams();
}

export async function generateMetadata({ params }: { params: Promise<{ dimension: string; slug: string; page: string }> }): Promise<Metadata> {
  return generateCategoryDetailMetadataForLocale("en", await params);
}

export default async function CategoryDetailPagedPage({ params }: { params: Promise<{ dimension: string; slug: string; page: string }> }) {
  const { dimension, slug, page: rawPage } = await params;
  const page = parsePositivePage(rawPage);
  if (!page) notFound();
  if (page === 1) permanentRedirect(categoryPath(dimension, slug));

  return <CategoryDetailPageView locale="en" dimension={dimension} slug={slug} page={page} />;
}
