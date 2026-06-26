import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { CATEGORY_DIMENSIONS } from "@/lib/categories/rules";
import { getCategoryRegistry, getMeta } from "@/lib/data";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { buildCategoryDimensionCapsule, resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { buildCategoryDimensionFaqs } from "@/lib/geo-faq";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { T } from "@/lib/i18n/client";
import { categoryPath, fallbackRegistry, findDimension, isCategoryDimension } from "../category-page-data";

const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = 86400;

export function generateStaticParams() {
  return CATEGORY_DIMENSIONS.map((dimension) => ({ dimension }));
}

export async function generateMetadata({ params }: { params: Promise<{ dimension: string }> }): Promise<Metadata> {
  const { dimension } = await params;
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const entry = findDimension(registry, dimension);
  const label = entry?.label ?? "Categories";
  return pageMeta({
    title: `${label} Categories`,
    description: `Browse tracked GitHub repositories by ${label.toLowerCase()}.`,
    path: categoryPath(dimension),
    locale: "en",
  });
}

export default async function CategoryDimensionPage({ params }: { params: Promise<{ dimension: string }> }) {
  const { dimension } = await params;
  if (!isCategoryDimension(dimension)) notFound();

  const [registryView, meta] = await Promise.all([getCategoryRegistry(), getMeta()]);
  const registry = registryView ?? fallbackRegistry();
  const entry = findDimension(registry, dimension);
  if (!entry) notFound();

  const categories = entry.categories.filter((category) => category.public);
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const pagePath = categoryPath(dimension);
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: `GitStarClub ${entry.label} Category Dataset`,
    path: pagePath,
    locale: LOC,
    description: `${entry.label} category definitions, counts, and crawlable category links generated from precomputed Blob category registry JSON.`,
    dateModified,
  });
  const capsule = asOf ? buildCategoryDimensionCapsule(entry, asOf) : null;
  const faqItems = buildCategoryDimensionFaqs(entry, asOf);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(`${entry.label} categories`, pagePath, LOC, { dateModified, about: datasetRef(pagePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          `${entry.label} categories`,
          pagePath,
          LOC,
          categories.map((category) => ({ name: category.label, path: categoryPath(category.dimension, category.slug) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs items={[{ path: "nav.home", href: "/" }, { path: "nav.categories", href: "/categories" }, { label: entry.label }]} />

        <section className="mt-5">
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">
            <T path="categories.dimensionEyebrow" />
          </p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">
            {entry.label}
          </h1>
          <p className="mt-3 max-w-[48ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">
            {categories.length} <T path="categories.publicGroups" />
          </p>
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" />}

        <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)] grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={categoryPath(category.dimension, category.slug)}
              className="rounded-lg bg-surface-container px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
            >
              <span className="block truncate font-mono text-[0.95rem] font-semibold text-on-surface" title={category.label}>
                {category.label}
              </span>
              <span className="mt-1 block font-mono text-[0.75rem] text-on-surface-variant">
                {category.count > 0 ? (
                  <>
                    {category.count} <T path="categories.repositories" />
                  </>
                ) : (
                  <T path="categories.pendingCount" />
                )}
              </span>
            </Link>
          ))}
        </section>

        <FaqBlock items={faqItems} path={categoryPath(dimension)} locale={LOC} />
      </main>
    </>
  );
}
