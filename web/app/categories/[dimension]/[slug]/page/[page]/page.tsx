import { notFound, permanentRedirect } from "next/navigation";
import { getCategoryRegistry } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { CategoryDetail, generateCategoryDetailMetadata } from "../../category-detail";
import { categoryPath, publicCategoryPageStaticParams } from "../../../../category-page-data";

export const dynamicParams = true;
export const revalidate = 86400;

export async function generateStaticParams() {
  return publicCategoryPageStaticParams(await getCategoryRegistry());
}

export const generateMetadata = generateCategoryDetailMetadata;

export default async function CategoryDetailPagedPage({
  params,
}: {
  params: Promise<{ dimension: string; slug: string; page: string }>;
}) {
  const { dimension, slug, page: rawPage } = await params;
  const page = parsePositivePage(rawPage);
  if (!page) notFound();
  if (page === 1) permanentRedirect(categoryPath(dimension, slug));

  return <CategoryDetail dimension={dimension} slug={slug} page={page} />;
}
