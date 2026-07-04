import type { Metadata } from "next";
import { CategoriesPageView, generateCategoriesMetadata } from "../../_localized/categories";
import { generateCoreLocaleStaticParams, resolveRouteLocale } from "../../_localized/routing";

type Params = Promise<{ locale: string }>;

export const revalidate = 86400;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generateCategoriesMetadata(locale);
}

export default async function LocalizedCategoriesPage({ params }: { params: Params }) {
  const locale = await resolveRouteLocale(params);
  return <CategoriesPageView locale={locale} />;
}
