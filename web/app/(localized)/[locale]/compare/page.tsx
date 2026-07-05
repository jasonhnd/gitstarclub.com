import type { Metadata } from "next";
import { ComparePageView, generateCompareMetadata } from "@/app/_localized/compare";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "@/app/_localized/routing";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generateCompareMetadata(locale);
}

export default async function LocalizedComparePage({ params }: { params: LocaleParams }) {
  const locale = await resolveRouteLocale(params);
  return <ComparePageView locale={locale} />;
}
