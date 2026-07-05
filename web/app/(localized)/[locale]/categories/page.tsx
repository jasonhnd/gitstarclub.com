import type { Metadata } from "next";
import { CategoriesPageView, generateCategoriesMetadata } from "@/app/_localized/categories";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams } from "@/app/_localized/routing";

type Params = Promise<{ locale: string }>;

export const revalidate = 86400;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generateCategoriesMetadata(locale));
}

export default async function LocalizedCategoriesPage({ params }: { params: Params }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <CategoriesPageView locale={locale} />);
}
