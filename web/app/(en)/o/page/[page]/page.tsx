import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getOrgsLookup } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { resolveEnglishRoute, routeMetadata, routeView } from "@/app/_localized/page-adapters";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "@/app/o/org-index-data";

type Params = Promise<{ page: string }>;

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({ page: String(index + 2) }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return routeMetadata(resolveEnglishRoute(params), (locale, { page: rawPage }) =>
    generateOrgIndexMetadata({ locale, page: parsePositivePage(rawPage) ?? 1 }),
  );
}

export default async function OrgIndexPagedPage({ params }: { params: Params }) {
  return routeView(resolveEnglishRoute(params), async (locale, { page: rawPage }) => {
    const page = parsePositivePage(rawPage);
    if (!page) notFound();
    if (page === 1) permanentRedirect(orgIndexPath());

    const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
    if (page > totalPages) notFound();

    return <OrgIndexPageView locale={locale} page={page} />;
  });
}
