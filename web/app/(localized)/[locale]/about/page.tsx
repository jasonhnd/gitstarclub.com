import type { Metadata } from "next";
import { AboutPageView, generateAboutMetadata } from "@/app/_localized/about";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generateAboutMetadata(locale);
}

export default async function LocalizedAboutPage({ params }: { params: LocaleParams }) {
  const locale = await resolveRouteLocale(params);
  return <AboutPageView locale={locale} />;
}
