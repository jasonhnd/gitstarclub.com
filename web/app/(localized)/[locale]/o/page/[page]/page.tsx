import { notFound, permanentRedirect } from "next/navigation";
import { createLocalizedPage } from "@/app/_localized/page-adapter";
import { generateOrgIndexMetadata, OrgIndexPageView } from "@/app/_localized/org-index";
import { localizedPath } from "@/lib/i18n/routing";
import { getOrgsLookup } from "@/lib/data";
import { parsePositivePage } from "@/lib/pagination";
import { orgIndexPageCount, orgIndexPath, orgIndexRows } from "@/app/o/org-index-data";

export const dynamicParams = true;
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

const route = createLocalizedPage<{ page: string }>({
  generateMetadata: ({ locale, params }) => {
    const page = parsePositivePage(params.page) ?? 1;
    return generateOrgIndexMetadata({ locale, page });
  },
  render: async ({ locale, params }) => {
    const page = parsePositivePage(params.page);
    if (!page) notFound();
    if (page === 1) permanentRedirect(localizedPath(locale, orgIndexPath()));

    const totalPages = orgIndexPageCount(orgIndexRows(await getOrgsLookup()).length);
    if (page > totalPages) notFound();

    return <OrgIndexPageView locale={locale} page={page} />;
  },
});

export const generateMetadata = route.generateMetadata;
export default route.Page;
