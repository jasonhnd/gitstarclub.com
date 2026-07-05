import type { Metadata } from "next";
import { ComparePageView, generateCompareMetadata } from "@/app/_localized/compare";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams, type LocaleParams } from "@/app/_localized/routing";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generateCompareMetadata(locale));
}

export default async function LocalizedComparePage({ params }: { params: LocaleParams }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <ComparePageView locale={locale} />);
}
