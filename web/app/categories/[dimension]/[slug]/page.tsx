import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getCategoryAllTime, getCategoryRegistry, getReposLookup, joinRepoRank } from "@/lib/data";
import { collectionLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import { T } from "@/lib/i18n/client";
import {
  categoryPath,
  fallbackRegistry,
  findCategory,
  findDimension,
  publicCategoryStaticParams,
} from "../../category-page-data";

const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = 60;

export async function generateStaticParams() {
  return publicCategoryStaticParams(await getCategoryRegistry());
}

export async function generateMetadata({ params }: { params: Promise<{ dimension: string; slug: string }> }): Promise<Metadata> {
  const { dimension, slug } = await params;
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, dimension, slug);
  const label = category?.label ?? slug;
  return pageMeta({
    title: `${label} GitHub Repository Rankings`,
    description: `Top tracked GitHub repositories in the ${label} category by current stars.`,
    path: categoryPath(dimension, slug),
    locale: "en",
  });
}

export default async function CategoryDetailPage({ params }: { params: Promise<{ dimension: string; slug: string }> }) {
  const { dimension, slug } = await params;
  const registry = (await getCategoryRegistry()) ?? fallbackRegistry();
  const category = findCategory(registry, dimension, slug);
  if (!category) notFound();

  const dimensionEntry = findDimension(registry, dimension);
  const [rank, lookup] = await Promise.all([getCategoryAllTime(dimension, slug), getReposLookup()]);
  const rows: Row[] =
    rank && lookup
      ? joinRepoRank(rank.items, lookup).map((repo) => ({
          owner: repo.owner,
          name: repo.name,
          lang: repo.language,
          total: repo.current_stars,
        }))
      : [];
  const siblingCategories = (dimensionEntry?.categories ?? []).filter((entry) => entry.public && entry.id !== category.id).slice(0, 8);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(`${category.label} repositories`, categoryPath(dimension, slug), LOC)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.categories", href: "/categories" },
            { label: dimensionEntry?.label ?? dimension, href: categoryPath(dimension) },
            { label: category.label },
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
            <Link href={categoryPath(dimension)} className="mt-5 inline-block font-mono text-[0.78rem] text-accent-text hover:underline">
              {dimensionEntry?.label ?? <T path="nav.categories" />}
            </Link>
          </aside>

          <div className="min-w-0">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-[1.3rem] font-extrabold text-on-surface">
                <T path="categories.topRepositories" />
              </h2>
              <span className="font-mono text-[0.75rem] text-on-surface-variant">
                <T path="categories.allTimeStars" />
              </span>
            </div>
            {rows.length > 0 ? (
              <RankingList rows={rows} variant="total" locale={LOC} />
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
