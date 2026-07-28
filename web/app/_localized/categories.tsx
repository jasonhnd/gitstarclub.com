import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PaginationNav } from "@/app/_explore/PaginationNav";
import { PageHero } from "@/app/_explore/PageHero";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { RelatedPages } from "@/app/_explore/RelatedPages";
import { CategorySummaryTable } from "@/app/_explore/SemanticDataTable";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { resolveAvailableCategoryPages } from "@/lib/categories/availability";
import { CATEGORY_DIMENSIONS, type CategoryDimension } from "@/lib/categories/rules";
import type { CategoryDimensionRegistry, CategoryRegistry } from "@/lib/contracts";
import { getCategoryAllTimePage, getCategoryRegistry, getMeta, getReposLookupDaily, joinRepoRank } from "@/lib/data";
import { formatInteger } from "@/lib/format";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { CATEGORY_DETAIL_PAGE_SIZE, parsePositivePage } from "@/lib/pagination";
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
  priorityLanguageStaticParams,
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
type CategoryDetailStaticParam = { dimension: string; slug: string };
type CategoryDetailPageStaticParam = CategoryDetailStaticParam & { page: string };

const DIMENSION_LABELS: Record<Locale, Record<CategoryDimension, string>> = {
  en: {
    language: "Language",
    language_family: "Language Family",
    domain: "Domain",
    project_type: "Project Type",
    ecosystem: "Ecosystem",
    owner_kind: "Owner Kind",
    maturity: "Maturity",
  },
  ja: {
    language: "言語",
    language_family: "言語ファミリー",
    domain: "ドメイン",
    project_type: "プロジェクト種別",
    ecosystem: "エコシステム",
    owner_kind: "所有者種別",
    maturity: "成熟度",
  },
  zh: {
    language: "语言",
    language_family: "语言家族",
    domain: "领域",
    project_type: "项目类型",
    ecosystem: "生态系统",
    owner_kind: "所有者类型",
    maturity: "成熟度",
  },
  "zh-TW": {
    language: "語言",
    language_family: "語言家族",
    domain: "領域",
    project_type: "專案類型",
    ecosystem: "生態系統",
    owner_kind: "擁有者類型",
    maturity: "成熟度",
  },
  ko: {
    language: "언어",
    language_family: "언어 계열",
    domain: "도메인",
    project_type: "프로젝트 유형",
    ecosystem: "생태계",
    owner_kind: "소유자 유형",
    maturity: "성숙도",
  },
  es: {
    language: "Lenguaje",
    language_family: "Familia de lenguaje",
    domain: "Dominio",
    project_type: "Tipo de proyecto",
    ecosystem: "Ecosistema",
    owner_kind: "Tipo de propietario",
    maturity: "Madurez",
  },
  fr: {
    language: "Langage",
    language_family: "Famille de langage",
    domain: "Domaine",
    project_type: "Type de projet",
    ecosystem: "Écosystème",
    owner_kind: "Type de propriétaire",
    maturity: "Maturité",
  },
};

export function generateCategoryDimensionStaticParams() {
  return CATEGORY_DIMENSIONS.map((dimension) => ({ dimension }));
}

export function generateLocalizedCategoryDimensionStaticParams(): Array<{ locale: Locale; dimension: string }> {
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => CATEGORY_DIMENSIONS.map((dimension) => ({ locale, dimension })));
}

export function generateCategoryDetailStaticParams(): CategoryDetailStaticParam[] {
  return priorityLanguageStaticParams();
}

export function generateLocalizedCategoryDetailStaticParams(): Array<CategoryDetailStaticParam & { locale: Locale }> {
  const params = generateCategoryDetailStaticParams();
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => params.map((param) => ({ locale, ...param })));
}

export function generateCategoryDetailPageStaticParams(): CategoryDetailPageStaticParam[] {
  return [];
}

export function generateLocalizedCategoryDetailPageStaticParams(): Array<CategoryDetailPageStaticParam & { locale: Locale }> {
  const params = generateCategoryDetailPageStaticParams();
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => params.map((param) => ({ locale, ...param })));
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
  const label = localizedDimensionLabel(locale, dimension, entry?.label ?? "Categories");
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
  const fallback = fallbackRegistry();
  const registry = registryView ?? fallback;
  const localizedRegistry = withLocalizedDimensionLabels(registry, locale);
  const publicCategories = publicCategoryEntries(registry);
  const dimensions = categoryDimensionGroups(registry, fallback, locale);
  const routePath = localizedPath(locale, "/categories");
  const href = (path: string) => localizedPath(locale, path);
  const categoryRows = publicCategories.map((category) => ({
    ...category,
    dimension: localizedDimensionLabel(locale, category.dimension),
    path: href(categoryPath(category.dimension, category.slug)),
  }));
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, { locale });
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: text.categoryIndexDatasetName,
    path: routePath,
    locale: language,
    description: text.categoryIndexDatasetDescription,
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryIndexCapsule(locale, localizedRegistry, asOf) : null;
  const faqItems = buildLocalizedCategoryIndexFaqs(locale, localizedRegistry, asOf);

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
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <PageHero
          eyebrow={t.categories.eyebrow}
          title={t.categories.title}
          lede={text.categoryIndexDatasetDescription}
          aside={
            <HeroStats
              items={[
                { label: t.categories.eyebrow, value: formatInteger(locale, publicCategories.length) },
                { label: t.categories.dimensionEyebrow, value: formatInteger(locale, dimensions.length) },
              ]}
            />
          }
        />

        <DeterministicNote title={text.categoryCountsQ} body={text.categoryCountsA} />

        <CategoryDimensionCards title={t.categories.browseByDimension} description={text.categoryIndexDatasetDescription} dimensions={dimensions} locale={locale} href={href} countLabel={t.categories.groups} />

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,4vw,3rem)]" labels={answerCapsuleLabels(locale, t)} />}

        <section className="mt-[clamp(2.5rem,5vw,4rem)]">
          <SectionIntro title={text.categorySummaryCaption} description={text.categoryIndexDatasetDescription} />
          {categoryRows.length > 0 ? (
            <CategorySummaryTable rows={categoryRows} caption={text.categorySummaryCaption} labels={categoryTableLabels(locale, t)} locale={locale} />
          ) : (
            <EmptyState message={t.categories.empty} />
          )}
        </section>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.categories.browseByDimension}</h2>
          <div className="mt-4 grid gap-[clamp(1.25rem,3vw,2rem)]">
            {dimensions.map((dimension) => (
              <section key={dimension.id} aria-labelledby={`dimension-${dimension.id}`}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id={`dimension-${dimension.id}`} className="text-[1.05rem] font-extrabold text-on-surface">
                    {dimension.label}
                  </h3>
                  <Link href={href(categoryPath(dimension.id))} className="text-primary font-mono text-[0.78rem] hover:underline">
                    {t.categories.viewAll}
                  </Link>
                </div>
                {dimension.categories.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {dimension.categories.slice(0, CATEGORY_INDEX_PREVIEW_LIMIT).map((category) => (
                      <CategoryLink key={category.id} href={href(categoryPath(category.dimension, category.slug))} label={category.label} count={category.count} locale={locale} />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={t.categories.empty} className="mt-0" />
                )}
              </section>
            ))}
          </div>
        </section>

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
  const fallback = fallbackRegistry();
  const registry = registryView ?? fallback;
  const entry = findDimension(registry, dimension);
  if (!entry) notFound();

  const entryLabel = localizedDimensionLabel(locale, entry.id, entry.label);
  const localizedEntry = { ...entry, label: entryLabel };
  const relatedDimensions = categoryDimensionGroups(registry, fallback, locale).filter((item) => item.id !== entry.id);
  const pagePath = categoryPath(dimension);
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const categories = entry.categories.filter((category) => category.public);
  const categoryRows = categories.map((category) => ({ ...category, dimension: entryLabel, path: href(categoryPath(category.dimension, category.slug)) }));
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, { locale });
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: fill(text.categoryDimensionDatasetName, { label: entryLabel }),
    path: routePath,
    locale: language,
    description: fill(text.categoryDimensionDatasetDescription, { label: entryLabel }),
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryDimensionCapsule(locale, localizedEntry, asOf) : null;
  const faqItems = buildLocalizedCategoryDimensionFaqs(locale, localizedEntry, asOf);

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.categoryDimensionCollectionName, { label: entryLabel }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.categoryDimensionItemListName, { label: entryLabel }),
          routePath,
          language,
          categories.map((category) => ({ name: category.label, path: localizedPath(locale, categoryPath(category.dimension, category.slug)) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "nav.categories", href: "/categories" }, { label: entryLabel }]} />

        <PageHero
          className="mt-5"
          eyebrow={t.categories.dimensionEyebrow}
          title={<span className="break-words [overflow-wrap:anywhere]">{entryLabel}</span>}
          lede={fill(text.categoryDimensionDatasetDescription, { label: entryLabel })}
          actions={<HeroActions links={[{ href: href("/categories"), label: t.nav.categories }]} />}
          aside={
            <HeroStats
              items={[
                { label: t.categories.groups, value: formatInteger(locale, categories.length) },
                { label: t.tables.slug, value: entry.id },
              ]}
            />
          }
        />

        <DeterministicNote title={fill(text.categoryNoClientQ, { label: entryLabel })} body={`${fill(text.categoryNoClientA, { label: entryLabel })} ${text.categoryCountsA}`} />

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" labels={answerCapsuleLabels(locale, t)} />}

        <section className="mt-[clamp(2.5rem,5vw,4rem)]">
          <SectionIntro title={fill(text.categoryDimensionSummaryCaption, { label: entryLabel })} description={fill(text.categoryLinksA, { label: entryLabel })} />
          {categoryRows.length > 0 ? (
            <CategorySummaryTable rows={categoryRows} caption={fill(text.categoryDimensionSummaryCaption, { label: entryLabel })} labels={categoryTableLabels(locale, t)} locale={locale} />
          ) : (
            <EmptyState message={t.categories.empty} />
          )}
        </section>

        <RelatedPages
          title={t.categories.browseByDimension}
          description={text.categoryIndexDatasetDescription}
          items={relatedDimensions.map((item) => relatedItem(href(categoryPath(item.id)), item.label))}
        />

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
  const [availability, rank, firstPageRank, lookup, meta] = await Promise.all([
    resolveAvailableCategoryPages(dimension, slug, category.count),
    getCategoryAllTimePage(dimension, slug, page),
    page > 1 ? getCategoryAllTimePage(dimension, slug, 1) : null,
    getReposLookupDaily(),
    getMeta(),
  ]);
  const totalRows = availability.totalRows;
  const totalPages = availability.availablePages.length;
  if (!availability.availablePages.includes(page)) notFound();
  if (totalRows > 0 && !rank) notFound();
  if (totalRows > 0 && page > 1 && !firstPageRank) notFound();

  const pageRows = categoryRows(rank?.items ?? [], lookup);
  if (totalRows > 0 && pageRows.length === 0) notFound();
  const topRows = page === 1 ? pageRows : categoryRows(firstPageRank?.items ?? [], lookup);
  const startRank = (page - 1) * CATEGORY_DETAIL_PAGE_SIZE + 1;
  const first = totalRows > 0 ? startRank : 0;
  const last = first + pageRows.length - 1;
  const siblingCategories = (dimensionEntry?.categories ?? []).filter((entry) => entry.public && entry.id !== category.id).slice(0, 8);
  const dimensionLabel = localizedDimensionLabel(locale, dimension, dimensionEntry?.label ?? dimension);
  const asOf = resolveDataAsOfLabel(rank?.meta.generated_at, registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, { locale });
  const pagePath = categoryDetailPagePath(dimension, slug, page);
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const dateModified = resolveDataAsOfValue(rank?.meta.generated_at, registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const tableLabels = repositoryTableLabels(t);
  const dataset = datasetLd({
    name: fill(text.categoryDetailDatasetName, { label: category.label }),
    path: routePath,
    locale: language,
    description: fill(text.categoryDetailDatasetDescription, { label: category.label }),
    dateModified,
  });
  const capsule = asOf ? buildLocalizedCategoryDetailCapsule({ locale, category, asOf, rows: topRows }) : null;
  const faqItems = buildLocalizedCategoryDetailFaqs({ locale, category, asOf, rows: topRows });

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
          pageRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) })),
          startRank,
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <Breadcrumbs
          locale={locale}
          dictionary={t}
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.categories", href: "/categories" },
            { label: dimensionLabel, href: categoryPath(dimension) },
            { label: page > 1 ? `${category.label} ${text.page} ${page}` : category.label },
          ]}
        />

        <PageHero
          className="mt-5"
          eyebrow={dimensionLabel}
          title={<span className="break-words [overflow-wrap:anywhere]">{category.label}</span>}
          lede={text.categoryDetailDataA}
          actions={
            <HeroActions
              links={[
                { href: href(categoryPath(dimension)), label: dimensionLabel },
                { href: "#category-ranking", label: text.completeRanking },
              ]}
            />
          }
          aside={
            <HeroStats
              items={[
                {
                  label: t.categories.repositories,
                  value: category.count > 0 ? `${formatInteger(locale, category.count)} ${t.categories.trackedRepositories}` : t.categories.countPending,
                },
                { label: t.categories.dimensionEyebrow, value: dimensionLabel },
                { label: t.tables.slug, value: category.slug },
              ]}
            />
          }
        />

        <DeterministicNote title={fill(text.categoryDetailDataQ, { label: category.label })} body={`${text.categoryDetailDataA} ${text.categoryCountsA}`} />

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,4vw,3rem)]" labels={answerCapsuleLabels(locale, t)} />}

        <section id="category-ranking" className="mt-[clamp(2.5rem,5vw,4rem)] scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.categories.topRepositories}</h2>
            <span className="font-mono text-[0.75rem] text-on-surface-variant">
              {totalRows > 0
                ? fill(text.range, {
                    first: formatInteger(locale, first),
                    last: formatInteger(locale, last),
                    total: formatInteger(locale, totalRows),
                  })
                : t.categories.allTimeStars}
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
                  labels={paginationLabels(t)}
                />
              </div>
            </>
          ) : (
            <EmptyState message={t.categories.rankingPending} />
          )}
          {totalPages > 1 && (
            <a href="#category-pages" className="text-readable-gold mt-3 inline-block font-mono text-[0.78rem] hover:underline">
              {fill(text.browseAllRepositories, { count: formatInteger(locale, totalRows) })}
            </a>
          )}
        </section>

        <RelatedPages
          title={t.categories.relatedCategories}
          description={fill(text.categoryLinksA, { label: dimensionLabel })}
          items={siblingCategories.map((entry) => relatedItem(href(categoryPath(entry.dimension, entry.slug)), entry.label))}
        />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function CategoryLink({ href, label, count, locale }: { href: string; label: string; count: number; locale: Locale }) {
  return (
    <Link
      href={href}
      className="flex min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
    >
      <span className="truncate font-mono text-[0.9rem] font-semibold text-on-surface" title={label}>
        {label}
      </span>
      {count > 0 ? <span className="shrink-0 font-mono text-[0.75rem] text-on-surface-variant">{formatInteger(locale, count)}</span> : null}
    </Link>
  );
}

function CategoryDimensionCards({
  title,
  description,
  dimensions,
  locale,
  href,
  countLabel,
}: {
  title: string;
  description: string;
  dimensions: CategoryDimensionRegistry[];
  locale: Locale;
  href: (path: string) => string;
  countLabel: string;
}) {
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <SectionIntro title={title} description={description} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {dimensions.map((dimension) => (
          <Link
            key={dimension.id}
            href={href(categoryPath(dimension.id))}
            className="group flex min-h-28 flex-col justify-between rounded-lg bg-surface-container px-4 py-4 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
          >
            <span className="block break-words text-[1.05rem] font-extrabold leading-tight text-on-surface group-hover:underline group-hover:underline-offset-2">{dimension.label}</span>
            <span className="mt-3 block font-mono text-[0.78rem] text-on-surface-variant">
              {formatInteger(locale, dimension.categories.length)} {countLabel}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function HeroActions({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <>
      {links.map((link) =>
        link.href.startsWith("#") ? (
          <a key={`${link.href}:${link.label}`} href={link.href} className={heroActionClass}>
            {link.label}
          </a>
        ) : (
          <Link key={`${link.href}:${link.label}`} href={link.href} className={heroActionClass}>
            {link.label}
          </Link>
        ),
      )}
    </>
  );
}

const heroActionClass =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline";

function HeroStats({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container px-4 py-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{item.label}</dt>
          <dd className="mt-1 break-words font-mono text-[0.95rem] font-extrabold text-on-surface">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-[64ch]">
      <h2 className="text-[1.25rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      <p className="mt-2 text-[0.95rem] leading-relaxed text-on-surface-variant">{description}</p>
    </div>
  );
}

function DeterministicNote({ title, body }: { title: string; body: string }) {
  return (
    <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)] rounded-lg border border-outline-variant bg-surface-container px-4 py-4">
      <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{title}</p>
      <p className="mt-2 max-w-[72ch] text-[0.95rem] leading-relaxed text-on-surface-variant">{body}</p>
    </section>
  );
}

function EmptyState({ message, className = "" }: { message: string; className?: string }) {
  return <p className={`mt-[clamp(1rem,2vw,1.5rem)] rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>{message}</p>;
}

function localizedDimensionLabel(locale: Locale, dimension: string, fallback = dimension): string {
  return isCategoryDimension(dimension) ? DIMENSION_LABELS[locale][dimension] ?? fallback : fallback;
}

function withLocalizedDimensionLabels(registry: CategoryRegistry, locale: Locale): CategoryRegistry {
  return {
    ...registry,
    dimensions: registry.dimensions.map((dimension) => ({
      ...dimension,
      label: localizedDimensionLabel(locale, dimension.id, dimension.label),
    })),
  };
}

function categoryDimensionGroups(registry: CategoryRegistry, fallback: CategoryRegistry, locale: Locale): CategoryDimensionRegistry[] {
  return orderedCategoryDimensions(registry, fallback).map((dimension) => ({
    ...dimension,
    label: localizedDimensionLabel(locale, dimension.id, dimension.label),
    categories: dimension.categories.filter((category) => category.public),
  }));
}

function orderedCategoryDimensions(registry: CategoryRegistry, fallback: CategoryRegistry): CategoryDimensionRegistry[] {
  return CATEGORY_DIMENSIONS.flatMap((dimension) => {
    const entry = findDimension(registry, dimension) ?? findDimension(fallback, dimension);
    return entry ? [entry] : [];
  });
}

function relatedItem(href: string, label: string) {
  return { href: href as `/${string}`, label };
}

function categoryRows(
  rankItems: NonNullable<Awaited<ReturnType<typeof getCategoryAllTimePage>>>["items"],
  lookup: Awaited<ReturnType<typeof getReposLookupDaily>>,
): Row[] {
  if (!lookup) return [];
  return joinRepoRank(rankItems, lookup).map((repo) => ({
    owner: repo.owner,
    name: repo.name,
    lang: repo.language,
    total: repo.current_stars,
  }));
}
