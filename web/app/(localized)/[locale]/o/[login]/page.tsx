import type { Metadata } from "next";
import { generateOrgMetadata, OrgPageView } from "@/app/_localized/org";
import { resolveLocaleSegment } from "@/app/_localized/routing";

export const dynamicParams = true;
export const revalidate = 86400;

// Do not prebuild the org x locale cross-product. Localized org pages are
// generated on demand and then refreshed by targeted invalidation.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; login: string }> }): Promise<Metadata> {
  const { locale, login } = await params;
  return generateOrgMetadata({ locale: resolveLocaleSegment(locale), login });
}

export default async function LocalizedOrgPage({ params }: { params: Promise<{ locale: string; login: string }> }) {
  const { locale, login } = await params;
  return <OrgPageView locale={resolveLocaleSegment(locale)} login={login} />;
}
