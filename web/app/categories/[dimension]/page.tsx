import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { CATEGORY_DIMENSIONS } from "@/lib/categories/rules";
import { getCategoryRegistry } from "@/lib/data";
import { collectionLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { categoryPath, fallbackRegistry, findDimension, isCategoryDimension } from "../category-page-data";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = 60;

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

  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const entry = findDimension(registry, dimension);
  if (!entry) notFound();

  const categories = entry.categories.filter((category) => category.public);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(`${entry.label} categories`, categoryPath(dimension), LOC)} />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs items={[{ path: "nav.home", href: "/" }, { label: "Categories", href: "/categories" }, { label: entry.label }]} />

        <section className="mt-5">
          <p className="font-mono text-[0.75rem] uppercase text-on-surface-variant">Category dimension</p>
          <h1 className="mt-2 text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none text-on-surface">
            {entry.label}
          </h1>
          <p className="mt-3 max-w-[48ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">
            {categories.length} public groups in the tracked repository set.
          </p>
        </section>

        <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)] grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Link
              key={category.id}
              href={categoryPath(category.dimension, category.slug)}
              className="rounded-lg bg-surface-container px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
            >
              <span className="block truncate font-mono text-[0.95rem] font-semibold text-on-surface">{category.label}</span>
              <span className="mt-1 block font-mono text-[0.75rem] text-on-surface-variant">
                {category.count > 0 ? `${category.count} repositories` : "Pending count"}
              </span>
            </Link>
          ))}
        </section>
      </main>
    </>
  );
}
