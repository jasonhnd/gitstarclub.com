import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { OrganizationRankingTable } from "@/app/_explore/SemanticDataTable";
import { PaginationNav } from "@/app/_explore/PaginationNav";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getOrgsLookup } from "@/lib/data";
import { collectionLd, itemListLd } from "@/lib/jsonld";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { ORG_INDEX_PAGE_SIZE } from "@/lib/pagination";
import { pageMeta } from "@/lib/seo";
import { orgIndexPageCount, orgIndexPageRows, orgIndexPath, orgIndexRows } from "./org-index-data";

const LOC = DEFAULT_LOCALE;

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "GitHub Organization Index",
    description: "Browse tracked GitHub organizations and developers by combined stars across their repositories.",
    path: orgIndexPath(),
    locale: "en",
  });
}

export default async function OrgIndexPage() {
  return <OrgIndex page={1} />;
}

export async function OrgIndex({ page }: { page: number }) {
  const rows = orgIndexRows(await getOrgsLookup());
  const totalPages = orgIndexPageCount(rows.length);
  const pageRows = orgIndexPageRows(rows, page);
  const first = rows.length > 0 ? (page - 1) * ORG_INDEX_PAGE_SIZE + 1 : 0;
  const last = first + pageRows.length - 1;

  return (
    <>
      <Chrome locale={LOC} canonicalPath={orgIndexPath(page)} />
      <JsonLd data={collectionLd("GitHub organization index", orgIndexPath(page), LOC)} />
      <JsonLd
        data={itemListLd(
          "GitHub organization index",
          orgIndexPath(page),
          LOC,
          pageRows.map((org) => ({ name: org.login, path: `/o/${org.login}` })),
          first || 1,
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <section>
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">Organizations</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">GitHub organization index</h1>
          <p className="mt-3 max-w-[54ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
            Crawlable index of tracked GitHub owners, sorted by combined stars across their tracked repositories.
          </p>
          {rows.length > 0 && (
            <p className="mt-4 font-mono text-[0.78rem] text-on-surface-variant">
              Showing {first}-{last} of {rows.length.toLocaleString("en-US")}
            </p>
          )}
        </section>

        <OrganizationRankingTable rows={pageRows} startRank={first || 1} caption={`GitHub organization index page ${page}`} />

        <PaginationNav currentPage={page} pageCount={totalPages} hrefForPage={orgIndexPath} label="Organizations pagination" />
      </main>
    </>
  );
}
