import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PaginationNav } from "@/app/_explore/PaginationNav";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getCategoryAllTime, getCategoryAssignments, getCategoryRegistry, getReposLookupDaily, joinRepoRank } from "@/lib/data";
import { collectionLd, itemListLd } from "@/lib/jsonld";
import { CATEGORY_DETAIL_PAGE_SIZE, pageCount, parsePositivePage, slicePage } from "@/lib/pagination";
import { pageMeta } from "@/lib/seo";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { T } from "@/lib/i18n/client";
import {
  categoryDetailPagePath,
  categoryPath,
  fallbackRegistry,
  findCategory,
  findDimension,
} from "../../category-page-data";

const LOC = DEFAULT_LOCALE;

type CategoryPageParams = { dimension: string; slug: string; page?: string };

export async function generateCategoryDetailMetadata({
  params,
}: {
  params: Promise<CategoryPageParams>;
}): Promise<Metadata> {
  const { dimension, slug, page: rawPage } = await params;
  const page = rawPage ? parsePositivePage(rawPage) ?? 1 : 1;
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, dimension, slug);
  const label = category?.label ?? slug;
  const pageSuffix = page > 1 ? ` - Page ${page}` : "";
  return pageMeta({
    title: `${label} GitHub Repository Rankings${pageSuffix}`,
    description: `Tracked GitHub repositories in the ${label} category by current stars${page > 1 ? `, page ${page}` : ""}.`,
    path: categoryDetailPagePath(dimension, slug, page),
    locale: "en",
  });
}

export async function CategoryDetail({ dimension, slug, page }: { dimension: string; slug: string; page: number }) {
  if (page < 1) notFound();

  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, dimension, slug);
  if (!category) notFound();

  const dimensionEntry = findDimension(registry, dimension);
  const [rank, lookup, assignments] = await Promise.all([getCategoryAllTime(dimension, slug), getReposLookupDaily(), getCategoryAssignments()]);
  const rows = categoryRows({
    categoryId: category.id,
    dimension: category.dimension,
    rankItems: rank?.items ?? [],
    lookup,
    assignments,
  });
  const totalPages = pageCount(rows.length, CATEGORY_DETAIL_PAGE_SIZE);
  if (page > totalPages && rows.length > 0) notFound();
  if (page > 1 && rows.length === 0) notFound();

  const pageRows = slicePage(rows, page, CATEGORY_DETAIL_PAGE_SIZE);
  const startRank = (page - 1) * CATEGORY_DETAIL_PAGE_SIZE + 1;
  const first = rows.length > 0 ? startRank : 0;
  const last = first + pageRows.length - 1;
  const siblingCategories = (dimensionEntry?.categories ?? []).filter((entry) => entry.public && entry.id !== category.id).slice(0, 8);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(`${category.label} repositories`, categoryDetailPagePath(dimension, slug, page), LOC)} />
      <JsonLd
        data={itemListLd(
          `${category.label} repositories`,
          categoryDetailPagePath(dimension, slug, page),
          LOC,
          pageRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
          startRank,
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.categories", href: "/categories" },
            { label: dimensionEntry?.label ?? dimension, href: categoryPath(dimension) },
            { label: page > 1 ? `${category.label} page ${page}` : category.label },
          ]}
        />

        <section className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <aside className="min-w-0">
            <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">
              {dimensionEntry?.label ?? dimension}
            </p>
            <h1 className="mt-2 break-words text-[clamp(2.2rem,5vw,3.25rem)] font-extrabold leading-none text-on-surface [overflow-wrap:anywhere]">
              {category.label}
            </h1>
            <p className="mt-3 text-[0.95rem] text-on-surface-variant">
              {category.count > 0 ? (
                <>
                  {category.count} <T path="categories.trackedRepositories" />
                </>
              ) : (
                <T path="categories.countPending" />
              )}
            </p>
            <LinkBack href={categoryPath(dimension)} label={dimensionEntry?.label ?? null} />
            {totalPages > 1 && (
              <a href="#category-pages" className="text-readable-gold mt-3 block font-mono text-[0.78rem] hover:underline">
                Browse all {rows.length.toLocaleString("en-US")} repositories
              </a>
            )}
          </aside>

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[1.3rem] font-extrabold text-on-surface">
                <T path="categories.topRepositories" />
              </h2>
              <span className="font-mono text-[0.75rem] text-on-surface-variant">
                {rows.length > 0 ? `${first}-${last} of ${rows.length.toLocaleString("en-US")}` : <T path="categories.allTimeStars" />}
              </span>
            </div>
            {pageRows.length > 0 ? (
              <>
                <RankingList rows={pageRows} variant="total" locale={LOC} startRank={startRank} />
                <div id="category-pages" className="scroll-mt-24">
                  <PaginationNav
                    currentPage={page}
                    pageCount={totalPages}
                    hrefForPage={(nextPage) => categoryDetailPagePath(dimension, slug, nextPage)}
                    label={`${category.label} pagination`}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-lg bg-surface-container px-4 py-3 text-[0.9rem] text-on-surface-variant">
                <T path="categories.rankingPending" />
              </p>
            )}

            {siblingCategories.length > 0 && (
              <section className="mt-[clamp(2rem,4vw,3rem)]">
                <h2 className="mb-3 text-[1.05rem] font-extrabold text-on-surface">
                  <T path="categories.relatedCategories" />
                </h2>
                <div className="flex flex-wrap gap-2">
                  {siblingCategories.map((entry) => (
                    <Link
                      key={entry.id}
                      href={categoryPath(entry.dimension, entry.slug)}
                      className="rounded-full bg-surface-container-high px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                    >
                      {entry.label}
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

function categoryRows({
  categoryId,
  dimension,
  rankItems,
  lookup,
  assignments,
}: {
  categoryId: string;
  dimension: keyof NonNullable<Awaited<ReturnType<typeof getCategoryAssignments>>>["repositories"][string];
  rankItems: NonNullable<Awaited<ReturnType<typeof getCategoryAllTime>>>["items"];
  lookup: Awaited<ReturnType<typeof getReposLookupDaily>>;
  assignments: Awaited<ReturnType<typeof getCategoryAssignments>>;
}): Row[] {
  if (!lookup) return [];
  if (assignments) {
    const rows = Object.entries(assignments.repositories).flatMap(([id, assignment]) => {
      if (!assignment[dimension].includes(categoryId)) return [];
      const repo = lookup[id];
      return repo ? [{ owner: repo.owner, name: repo.name, lang: repo.language, total: repo.current_stars }] : [];
    });
    if (rows.length > 0) {
      return rows.sort((a, b) => b.total - a.total || `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`));
    }
  }
  return joinRepoRank(rankItems, lookup).map((repo) => ({
    owner: repo.owner,
    name: repo.name,
    lang: repo.language,
    total: repo.current_stars,
  }));
}

function LinkBack({ href, label }: { href: string; label: string | null }) {
  return (
    <Link href={href} className="text-readable-gold mt-5 inline-block font-mono text-[0.78rem] hover:underline">
      {label ?? <T path="nav.categories" />}
    </Link>
  );
}
