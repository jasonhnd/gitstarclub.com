import type { Metadata } from "next";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

export const dynamicParams = true;
export const revalidate = 3600;

// Keep localized org index pages on-demand instead of prebuilding a locale
// multiplier for the owner directory.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale) => generateOrgIndexMetadata({ locale, page: 1 }));
}

export default async function LocalizedOrgIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  return routeView(resolveLocalizedRoute(params), (locale) => <OrgIndexPageView locale={locale} page={1} />);
}
