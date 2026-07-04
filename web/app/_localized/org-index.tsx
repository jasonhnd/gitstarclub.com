import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { OrganizationRankingTable } from "@/app/_explore/SemanticDataTable";
import { PaginationNav } from "@/app/_explore/PaginationNav";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getOrgsLookup } from "@/lib/data";
import { collectionLd, itemListLd } from "@/lib/jsonld";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { ORG_INDEX_PAGE_SIZE } from "@/lib/pagination";
import { pageMeta } from "@/lib/seo";
import { orgIndexPageCount, orgIndexPageRows, orgIndexPath, orgIndexRows } from "@/app/o/org-index-data";
import { organizationTableLabels } from "./routing";

export async function generateOrgIndexMetadata({ locale, page }: { locale: Locale; page: number }): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    title: page <= 1 ? t.org.indexTitle : fill(t.org.indexPageTitle, { page: String(page) }),
    description: t.org.indexDescription,
    path: orgIndexPath(page),
    locale,
  });
}

export async function OrgIndexPageView({ locale, page }: { locale: Locale; page: number }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const canonicalPath = orgIndexPath(page);
  const routePath = localizedPath(locale, canonicalPath);
  const rows = orgIndexRows(await getOrgsLookup());
  const totalPages = orgIndexPageCount(rows.length);
  const pageRows = orgIndexPageRows(rows, page);
  const first = rows.length > 0 ? (page - 1) * ORG_INDEX_PAGE_SIZE + 1 : 0;
  const last = first + pageRows.length - 1;
  const labels = organizationTableLabels(t);

  return (
    <>
      <Chrome locale={locale} canonicalPath={canonicalPath} dictionary={t} />
      <JsonLd data={collectionLd(t.org.indexTitle, routePath, language)} />
      <JsonLd
        data={itemListLd(
          t.org.indexTitle,
          routePath,
          language,
          pageRows.map((org) => ({ name: org.login, path: localizedPath(locale, `/o/${org.login}`) })),
          first || 1,
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <section>
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">{t.org.indexEyebrow}</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">{t.org.indexTitle}</h1>
          <p className="mt-3 max-w-[54ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
            {t.org.indexDescription}
          </p>
          {rows.length > 0 && (
            <p className="mt-4 font-mono text-[0.78rem] text-on-surface-variant">
              {fill(t.org.indexShowing, { first: String(first), last: String(last), total: rows.length.toLocaleString(language) })}
            </p>
          )}
        </section>

        <OrganizationRankingTable
          rows={pageRows}
          startRank={first || 1}
          caption={fill(t.org.indexCaption, { page: String(page) })}
          labels={labels}
          locale={locale}
        />

        <PaginationNav
          currentPage={page}
          pageCount={totalPages}
          hrefForPage={(nextPage) => localizedPath(locale, orgIndexPath(nextPage))}
          label={t.org.indexPagination}
          labels={{ previous: t.common.previous, next: t.common.next }}
        />
      </main>
    </>
  );
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
