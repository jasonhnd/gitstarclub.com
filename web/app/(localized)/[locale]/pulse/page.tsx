import type { Metadata } from "next";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { generateCoreLocaleStaticParams, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generatePulseMetadata({ locale, canonicalPath: "/pulse" }));
}

export default async function LocalizedPulsePage({ params }: { params: LocaleParams }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <PulsePageView locale={locale} canonicalPath="/pulse" />);
}
