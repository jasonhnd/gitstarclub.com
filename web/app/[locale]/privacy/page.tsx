import type { Metadata } from "next";
import { generatePrivacyMetadata, PrivacyPageView } from "../../_localized/privacy";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "../../_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generatePrivacyMetadata(locale);
}

export default async function LocalizedPrivacyPage({ params }: { params: LocaleParams }) {
  const locale = await resolveRouteLocale(params);
  return <PrivacyPageView locale={locale} />;
}
