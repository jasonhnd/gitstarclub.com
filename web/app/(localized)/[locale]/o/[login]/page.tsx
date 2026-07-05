import type { Metadata } from "next";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";

export const dynamicParams = true;
export const revalidate = 86400;

// Do not prebuild the org x locale cross-product. Localized org pages are
// generated on demand and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; login: string }> }): Promise<Metadata> {
  return routeMetadata(resolveLocalizedRoute(params), (locale, { login }) => generateOrgMetadata({ locale, login }));
}

export default async function LocalizedOrgPage({ params }: { params: Promise<{ locale: string; login: string }> }) {
  return routeView(resolveLocalizedRoute(params), (locale, { login }) => <OrgPageView locale={locale} login={login} />);
}
