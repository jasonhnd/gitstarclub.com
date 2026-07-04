import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PaginationNav } from "@/app/_explore/PaginationNav";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { CategorySummaryTable } from "@/app/_explore/SemanticDataTable";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { CATEGORY_DIMENSIONS } from "@/lib/categories/rules";
import { getCategoryAllTime, getCategoryAssignments, getCategoryRegistry, getMeta, getReposLookupDaily, joinRepoRank } from "@/lib/data";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { CATEGORY_DETAIL_PAGE_SIZE, pageCount, parsePositivePage, slicePage } from "@/lib/pagination";
import { pageMeta } from "@/lib/seo";
import {
  CATEGORY_INDEX_PREVIEW_LIMIT,
  categoryDetailPagePath,
  categoryPath,
  fallbackRegistry,
  findCategory,
  findDimension,
  isCategoryDimension,
  publicCategoryEntries,
  publicDimensions,
} from "@/app/categories/category-page-data";
import { repositoryTableLabels } from "./routing";
import {
  answerCapsuleLabels,
  buildLocalizedCategoryDetailCapsule,
  buildLocalizedCategoryDetailFaqs,
  buildLocalizedCategoryDimensionCapsule,
  buildLocalizedCategoryDimensionFaqs,
  buildLocalizedCategoryIndexCapsule,
  buildLocalizedCategoryIndexFaqs,
  categoryTableLabels,
  detailText,
  fill,
  paginationLabels,
} from "./detail-copy";
import { generateCoreLocaleStaticParams } from "./routing";

type CategoryPageParams = { dimension: string; slug: string; page?: string };

export function generateCategoryDimensionStaticParams() {
  return CATEGORY_DIMENSIONS.map((dimension) => ({ dimension }));
}

export function generateLocalizedCategoryDimensionStaticParams(): Array<{ locale: Locale; dimension: string }> {
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => CATEGORY_DIMENSIONS.map((dimension) => ({ locale, dimension })));
}

export function generateCategoryDetailStaticParams(): [] {
  return [];
}

export async function generateCategoriesMetadata(locale: Locale): Promise<Metadata> {
  const text = detailText(locale);
  return pageMeta({
    title: text.categoryIndexMetaTitle,
    description: text.categoryIndexMetaDescription,
    path: "/categories",
    locale,
  });
}

export async function generateCategoryDimensionMetadata(locale: Locale, dimension: string): Promise<Metadata> {
  const text = detailText(locale);
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const entry = findDimension(registry, dimension);
  const label = entry?.label ?? "Categories";
  return pageMeta({
    title: fill(text.categoryDimensionMetaTitle, { label }),
    description: fill(text.categoryDimensionMetaDescription, { label }),
    path: categoryPath(dimension),
    locale,
  });
}

export async function generateCategoryDetailMetadataForLocale(locale: Locale, params: CategoryPageParams): Promise<Metadata> {
  const text = detailText(locale);
  const page = params.page ? parsePositivePage(params.page) ?? 1 : 1;
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, params.dimension, params.slug);
  const label = category?.label ?? params.slug;
  const pageSuffix = page > 1 ? fill(text.pageSuffix, { page }) : "";
  return pageMeta({
    title: fill(text.categoryDetailMetaTitle, { label, pageSuffix }),
    description: fill(text.categoryDetailMetaDescription, { label, pageSuffix }),
    path: categoryDetailPagePath(params.dimension, params.slug, page),
    locale,
  });
}

export async function CategoriesPageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const [registryView, meta] = await Promise.all([getCategoryRegistry(), getMeta()]);
  const registry = registryView ?? fallbackRegistry();
  const publicCategories = publicCategoryEntries(registry);
  const dimensions = publicDimensions(registry);
  const routePath = localizedPath(locale, "/categories");
  const href = (path: string) => localizedPath(locale, path);
  const categoryRows = publicCategories.map((category) => ({ ...category, path: href(categoryPath(category.dimension, category.slug)) }));
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: text.categoryIndexDatasetName,
    path: routePath,
    locale: language,
    description: text.categoryIndexDatasetDescription,
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryIndexCapsule(locale, registry, asOf) : null;
  const faqItems = buildLocalizedCategoryIndexFaqs(locale, registry, asOf);

  return (
    <>
      <Chrome locale={locale} canonicalPath="/categories" dictionary={t} />
      <JsonLd data={collectionLd(text.categoryIndexCollectionName, routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          text.categoryIndexItemListName,
          routePath,
          language,
          publicCategories.map((category) => ({ name: category.label, path: localizedPath(locale, categoryPath(category.dimension, category.slug)) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <section>
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">{t.categories.eyebrow}</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">{t.categories.title}</h1>
          <p className="mt-3 max-w-[50ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">{t.categories.subtitle}</p>
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" labels={answerCapsuleLabels(locale, t)} />}

        <CategorySummaryTable rows={categoryRows} caption={text.categorySummaryCaption} labels={categoryTableLabels(locale, t)} />

        <section className="mt-[clamp(1.5rem,3vw,2.25rem)] grid gap-3 md:grid-cols-3">
          {registry.dimensions.map((dimension) => {
            const visible = dimension.categories.filter((category) => category.public);
            return (
              <Link
                key={dimension.id}
                href={href(categoryPath(dimension.id))}
                className="rounded-lg bg-surface-container px-4 py-4 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
              >
                <span className="block text-[1.05rem] font-extrabold text-on-surface">{dimension.label}</span>
                <span className="mt-2 block font-mono text-[0.78rem] text-on-surface-variant">
                  {visible.length} {t.categories.groups}
                </span>
              </Link>
            );
          })}
        </section>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="text-[1.3rem] font-extrabold text-on-surface">{t.categories.browseByDimension}</h2>
          <div className="mt-4 grid gap-[clamp(1.25rem,3vw,2rem)]">
            {dimensions.map((dimension) => (
              <section key={dimension.id} aria-labelledby={`dimension-${dimension.id}`}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id={`dimension-${dimension.id}`} className="text-[1.05rem] font-extrabold text-on-surface">
                    {dimension.label}
                  </h3>
                  <Link href={href(categoryPath(dimension.id))} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
                    {t.categories.viewAll}
                  </Link>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {dimension.categories.slice(0, CATEGORY_INDEX_PREVIEW_LIMIT).map((category) => (
                    <CategoryLink key={category.id} href={href(categoryPath(category.dimension, category.slug))} label={category.label} count={category.count} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        {publicCategories.length === 0 && <p className="mt-8 rounded-lg bg-surface-container px-4 py-3 text-[0.9rem] text-on-surface-variant">{t.categories.empty}</p>}

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

export async function CategoryDimensionPageView({ locale, dimension }: { locale: Locale; dimension: string }) {
  if (!isCategoryDimension(dimension)) notFound();

  const t = await getDictionary(locale);
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const [registryView, meta] = await Promise.all([getCategoryRegistry(), getMeta()]);
  const registry = registryView ?? fallbackRegistry();
  const entry = findDimension(registry, dimension);
  if (!entry) notFound();

  const pagePath = categoryPath(dimension);
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const categories = entry.categories.filter((category) => category.public);
  const categoryRows = categories.map((category) => ({ ...category, path: href(categoryPath(category.dimension, category.slug)) }));
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: fill(text.categoryDimensionDatasetName, { label: entry.label }),
    path: routePath,
    locale: language,
    description: fill(text.categoryDimensionDatasetDescription, { label: entry.label }),
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryDimensionCapsule(locale, entry, asOf) : null;
  const faqItems = buildLocalizedCategoryDimensionFaqs(locale, entry, asOf);

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.categoryDimensionCollectionName, { label: entry.label }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.categoryDimensionItemListName, { label: entry.label }),
          routePath,
          language,
          categories.map((category) => ({ name: category.label, path: localizedPath(locale, categoryPath(category.dimension, category.slug)) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "nav.categories", href: "/categories" }, { label: entry.label }]} />

        <section className="mt-5">
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">{t.categories.dimensionEyebrow}</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">{entry.label}</h1>
          <p className="mt-3 max-w-[48ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">
            {categories.length} {t.categories.publicGroups}
          </p>
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" labels={answerCapsuleLabels(locale, t)} />}

        <CategorySummaryTable rows={categoryRows} caption={fill(text.categoryDimensionSummaryCaption, { label: entry.label })} labels={categoryTableLabels(locale, t)} />

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

export async function CategoryDetailPageView({ locale, dimension, slug, page }: { locale: Locale; dimension: string; slug: string; page: number }) {
  if (page < 1) notFound();

  const t = await getDictionary(locale);
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, dimension, slug);
  if (!category) notFound();

  const dimensionEntry = findDimension(registry, dimension);
  const [rank, lookup, assignments, meta] = await Promise.all([getCategoryAllTime(dimension, slug), getReposLookupDaily(), getCategoryAssignments(), getMeta()]);
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
  const asOf = resolveDataAsOfLabel(rank?.meta.generated_at, registry.generated_at, assignments?.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const pagePath = categoryDetailPagePath(dimension, slug, page);
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const dateModified = resolveDataAsOfValue(rank?.meta.generated_at, registry.generated_at, assignments?.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const tableLabels = repositoryTableLabels(t);
  const dataset = datasetLd({
    name: fill(text.categoryDetailDatasetName, { label: category.label }),
    path: routePath,
    locale: language,
    description: fill(text.categoryDetailDatasetDescription, { label: category.label }),
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryDetailCapsule({ locale, category, asOf, rows }) : null;
  const faqItems = buildLocalizedCategoryDetailFaqs({ locale, category, asOf, rows });

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.categoryDetailCollectionName, { label: category.label }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.categoryDetailItemListName, { label: category.label }),
          routePath,
          language,
          pageRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
          startRank,
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          locale={locale}
          dictionary={t}
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.categories", href: "/categories" },
            { label: dimensionEntry?.label ?? dimension, href: categoryPath(dimension) },
            { label: page > 1 ? `${category.label} ${text.page} ${page}` : category.label },
          ]}
        />

        <section className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <aside className="min-w-0">
            <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">{dimensionEntry?.label ?? dimension}</p>
            <h1 className="mt-2 break-words text-[clamp(2.2rem,5vw,3.25rem)] font-extrabold leading-none text-on-surface [overflow-wrap:anywhere]">{category.label}</h1>
            <p className="mt-3 text-[0.95rem] text-on-surface-variant">
              {category.count > 0 ? (
                <>
                  {category.count} {t.categories.trackedRepositories}
                </>
              ) : (
                t.categories.countPending
              )}
            </p>
            <LinkBack href={href(categoryPath(dimension))} label={dimensionEntry?.label ?? t.nav.categories} />
            {totalPages > 1 && (
              <a href="#category-pages" className="text-readable-gold mt-3 block font-mono text-[0.78rem] hover:underline">
                {fill(text.browseAllRepositories, { count: rows.length.toLocaleString("en-US") })}
              </a>
            )}
          </aside>

          <div className="min-w-0">
            {capsule && <AnswerCapsule capsule={capsule} className="mb-6" labels={answerCapsuleLabels(locale, t)} />}

            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-[1.3rem] font-extrabold text-on-surface">{t.categories.topRepositories}</h2>
              <span className="font-mono text-[0.75rem] text-on-surface-variant">
                {rows.length > 0 ? fill(text.range, { first, last, total: rows.length.toLocaleString("en-US") }) : t.categories.allTimeStars}
              </span>
            </div>
            {pageRows.length > 0 ? (
              <>
                <RankingList rows={pageRows} variant="total" locale={locale} startRank={startRank} tableCaption={fill(text.categoryDetailCaption, { label: category.label })} labels={tableLabels} />
                <div id="category-pages" className="scroll-mt-24">
                  <PaginationNav
                    currentPage={page}
                    pageCount={totalPages}
                    hrefForPage={(nextPage) => href(categoryDetailPagePath(dimension, slug, nextPage))}
                    label={fill(text.categoryPagination, { label: category.label })}
                    labels={paginationLabels(locale)}
                  />
                </div>
              </>
            ) : (
              <p className="rounded-lg bg-surface-container px-4 py-3 text-[0.9rem] text-on-surface-variant">{t.categories.rankingPending}</p>
            )}

            {siblingCategories.length > 0 && (
              <section className="mt-[clamp(2rem,4vw,3rem)]">
                <h2 className="mb-3 text-[1.05rem] font-extrabold text-on-surface">{t.categories.relatedCategories}</h2>
                <div className="flex flex-wrap gap-2">
                  {siblingCategories.map((entry) => (
                    <Link
                      key={entry.id}
                      href={href(categoryPath(entry.dimension, entry.slug))}
                      className="rounded-full bg-surface-container-high px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                    >
                      {entry.label}
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
          </div>
        </section>
      </main>
    </>
  );
}

function CategoryLink({ href, label, count }: { href: string; label: string; count: number }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
    >
      <span className="truncate font-mono text-[0.9rem] font-semibold text-on-surface" title={label}>
        {label}
      </span>
      {count > 0 ? <span className="shrink-0 font-mono text-[0.75rem] text-on-surface-variant">{count}</span> : null}
    </Link>
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

function LinkBack({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-readable-gold mt-5 inline-block font-mono text-[0.78rem] hover:underline">
      {label}
    </Link>
  );
}
