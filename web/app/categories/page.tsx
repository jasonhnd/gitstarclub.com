import Link from "next/link";
import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { CategorySummaryTable } from "@/app/_explore/SemanticDataTable";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getCategoryRegistry, getMeta } from "@/lib/data";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { buildCategoryIndexCapsule, resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { buildCategoryIndexFaqs } from "@/lib/geo-faq";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { T } from "@/lib/i18n/client";
import { CATEGORY_INDEX_PREVIEW_LIMIT, categoryPath, fallbackRegistry, publicCategoryEntries, publicDimensions } from "./category-page-data";

const LOC = DEFAULT_LOCALE;

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  return pageMeta({
    title: "GitHub Repository Categories",
    description: "Browse tracked GitHub repositories by language, ecosystem, domain, project type, owner kind, and maturity.",
    path: "/categories",
    locale: "en",
  });
}

export default async function CategoriesPage() {
  const [registryView, meta] = await Promise.all([getCategoryRegistry(), getMeta()]);
  const registry = registryView ?? fallbackRegistry();
  const publicCategories = publicCategoryEntries(registry);
  const dimensions = publicDimensions(registry);
  const categoryRows = publicCategories.map((category) => ({ ...category, path: categoryPath(category.dimension, category.slug) }));
  const asOf = resolveDataAsOfLabel(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dateModified = resolveDataAsOfValue(registry.generated_at, meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataset = datasetLd({
    name: "GitStarClub Category Registry Dataset",
    path: "/categories",
    locale: LOC,
    description: "Public category dimensions, category counts, and crawlable category links generated from precomputed Blob category registry JSON.",
    dateModified,
  });
  const capsule = asOf ? buildCategoryIndexCapsule(registry, asOf) : null;
  const faqItems = buildCategoryIndexFaqs(registry, asOf);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd("GitHub repository categories", "/categories", LOC, { dateModified, about: datasetRef("/categories") })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          "GitHub repository categories",
          "/categories",
          LOC,
          publicCategories.map((category) => ({ name: category.label, path: categoryPath(category.dimension, category.slug) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <section>
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">
            <T path="categories.eyebrow" />
          </p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">
            <T path="categories.title" />
          </h1>
          <p className="mt-3 max-w-[50ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
            <T path="categories.subtitle" />
          </p>
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" />}

        <CategorySummaryTable rows={categoryRows} caption="Public GitHub repository categories" />

        <section className="mt-[clamp(1.5rem,3vw,2.25rem)] grid gap-3 md:grid-cols-3">
          {registry.dimensions.map((dimension) => {
            const visible = dimension.categories.filter((category) => category.public);
            return (
              <Link
                key={dimension.id}
                href={categoryPath(dimension.id)}
                className="rounded-lg bg-surface-container px-4 py-4 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
              >
                <span className="block text-[1.05rem] font-extrabold text-on-surface">{dimension.label}</span>
                <span className="mt-2 block font-mono text-[0.78rem] text-on-surface-variant">
                  {visible.length} <T path="categories.groups" />
                </span>
              </Link>
            );
          })}
        </section>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="text-[1.3rem] font-extrabold text-on-surface">
            <T path="categories.browseByDimension" />
          </h2>
          <div className="mt-4 grid gap-[clamp(1.25rem,3vw,2rem)]">
            {dimensions.map((dimension) => (
              <section key={dimension.id} aria-labelledby={`dimension-${dimension.id}`}>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 id={`dimension-${dimension.id}`} className="text-[1.05rem] font-extrabold text-on-surface">
                    {dimension.label}
                  </h3>
                  <Link href={categoryPath(dimension.id)} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
                    <T path="categories.viewAll" />
                  </Link>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {dimension.categories.slice(0, CATEGORY_INDEX_PREVIEW_LIMIT).map((category) => (
                    <CategoryLink key={category.id} href={categoryPath(category.dimension, category.slug)} label={category.label} count={category.count} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>

        {publicCategories.length === 0 && (
          <p className="mt-8 rounded-lg bg-surface-container px-4 py-3 text-[0.9rem] text-on-surface-variant">
            <T path="categories.empty" />
          </p>
        )}

        <FaqBlock items={faqItems} path="/categories" locale={LOC} />
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
