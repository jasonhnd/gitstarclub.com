import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { resolveLocaleSegment } from "@/app/_localized/routing";
import { localizedPath } from "@/lib/i18n/routing";
import { getOrgsLookup } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "@/app/o/org-index-data";

export const dynamicParams = true;
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; page: string }> }): Promise<Metadata> {
  const { locale, page: rawPage } = await params;
  const page = parsePositivePage(rawPage) ?? 1;
  return generateOrgIndexMetadata({ locale: resolveLocaleSegment(locale), page });
}

export default async function LocalizedOrgIndexPagedPage({ params }: { params: Promise<{ locale: string; page: string }> }) {
  const { locale, page: rawPage } = await params;
  const routeLocale = resolveLocaleSegment(locale);
  const page = parsePositivePage(rawPage);
  if (!page) notFound();
  if (page === 1) permanentRedirect(localizedPath(routeLocale, orgIndexPath()));

  const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
  if (page > totalPages) notFound();

  return <OrgIndexPageView locale={routeLocale} page={page} />;
}
