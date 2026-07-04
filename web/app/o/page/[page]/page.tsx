import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getOrgsLookup } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "../../org-index-data";

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({ page: String(index + 2) }));
}

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const page = parsePositivePage((await params).page) ?? 1;
  return generateOrgIndexMetadata({ locale: "en", page });
}

export default async function OrgIndexPagedPage({ params }: { params: Promise<{ page: string }> }) {
  const page = parsePositivePage((await params).page);
  if (!page) notFound();
  if (page === 1) permanentRedirect(orgIndexPath());

  const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
  if (page > totalPages) notFound();

  return <OrgIndexPageView locale="en" page={page} />;
}
