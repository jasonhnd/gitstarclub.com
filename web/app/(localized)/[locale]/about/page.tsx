import type { Metadata } from "next";
import { AboutPageView, generateAboutMetadata } from "@/app/_localized/about";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generateAboutMetadata(locale));
}

export default async function LocalizedAboutPage({ params }: { params: LocaleParams }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <AboutPageView locale={locale} />);
}
