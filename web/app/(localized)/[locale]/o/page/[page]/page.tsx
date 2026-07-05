import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { resolveLocalizedRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
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
  return routeMetadata(resolveLocalizedRoute(params), (locale, { page: rawPage }) =>
    generateOrgIndexMetadata({ locale, page: parsePositivePage(rawPage) ?? 1 }),
  );
}

export default async function LocalizedOrgIndexPagedPage({ params }: { params: Promise<{ locale: string; page: string }> }) {
  return routeView(resolveLocalizedRoute(params), async (locale, { page: rawPage }) => {
    const page = parsePositivePage(rawPage);
    if (!page) notFound();
    if (page === 1) permanentRedirect(localizedPath(locale, orgIndexPath()));

    const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
    if (page > totalPages) notFound();

    return <OrgIndexPageView locale={locale} page={page} />;
  });
}
