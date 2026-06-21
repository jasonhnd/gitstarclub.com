import { getCategoryRegistry } from "@/lib/data";
import { CategoryDetail, generateCategoryDetailMetadata } from "./category-detail";
import { publicCategoryStaticParams } from "../../category-page-data";

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  return publicCategoryStaticParams(await getCategoryRegistry());
}

export const generateMetadata = generateCategoryDetailMetadata;

export default async function CategoryDetailPage({ params }: { params: Promise<{ dimension: string; slug: string }> }) {
  const { dimension, slug } = await params;
  return <CategoryDetail dimension={dimension} slug={slug} page={1} />;
}
