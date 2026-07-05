import type { Metadata } from "next";
import { generatePrivacyMetadata, PrivacyPageView } from "@/app/_localized/privacy";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generatePrivacyMetadata(locale));
}

export default async function LocalizedPrivacyPage({ params }: { params: LocaleParams }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <PrivacyPageView locale={locale} />);
}
