import type { Metadata } from "next";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { resolveLocaleSegment } from "@/app/_localized/routing";

export const dynamicParams = true;
export const revalidate = 3600;

// Keep localized org index pages on-demand instead of prebuilding a locale
// multiplier for the owner directory.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return generateOrgIndexMetadata({ locale: resolveLocaleSegment(locale), page: 1 });
}

export default async function LocalizedOrgIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return <OrgIndexPageView locale={resolveLocaleSegment(locale)} page={1} />;
}
