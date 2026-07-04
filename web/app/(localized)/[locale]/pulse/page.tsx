import type { Metadata } from "next";
import { generatePulseMetadata, PulsePageView } from "@/app/_localized/pulse";
import { generateCoreLocaleStaticParams, resolveRouteLocale, type LocaleParams } from "@/app/_localized/routing";

export const revalidate = false;

export function generateStaticParams() {
  return generateCoreLocaleStaticParams();
}

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveRouteLocale(params);
  return generatePulseMetadata({ locale, canonicalPath: "/pulse" });
}

export default async function LocalizedPulsePage({ params }: { params: LocaleParams }) {
  const locale = await resolveRouteLocale(params);
  return <PulsePageView locale={locale} canonicalPath="/pulse" />;
}
