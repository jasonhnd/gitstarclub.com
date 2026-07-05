import { notFound, permanentRedirect } from "next/navigation";
import { createEnglishPage } from "@/app/_localized/page-adapter";
import { getOrgsLookup } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "@/app/o/org-index-data";

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
  return Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => ({ page: String(index + 2) }));
}

const route = createEnglishPage<{ page: string }>({
  generateMetadata: ({ locale, params }) => {
    const page = parsePositivePage(params.page) ?? 1;
    return generateOrgIndexMetadata({ locale, page });
  },
  render: async ({ locale, params }) => {
    const page = parsePositivePage(params.page);
    if (!page) notFound();
    if (page === 1) permanentRedirect(orgIndexPath());

    const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
    if (page > totalPages) notFound();

    return <OrgIndexPageView locale={locale} page={page} />;
  },
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
