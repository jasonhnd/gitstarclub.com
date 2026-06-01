import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars, monthLabel } from "@/lib/format";
import { collectionLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { getPreferredDictionary } from "@/lib/i18n/server";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [{ year: String(currentUtcPeriods().year) }];
}

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return pageMeta({
    title: `${year} GitHub Star Rankings — Yearly Movers`,
    description: `The ${year} ranking of GitHub repositories by stars gained, with month-by-month history.`,
    path: `/rankings/${year}`,
    locale: "en",
  });
}

export default async function RankingsYearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: ys } = await params;
  const { locale: loc, t } = await getPreferredDictionary();
  const year = Number(ys);
  const currentYear = currentUtcPeriods().year;
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) notFound();

  const [rank, heat, lookup] = await Promise.all([
    getRank("year", String(year), "repo", "flow"),
    getHeatmap("year", String(year)),
    getReposLookup(),
  ]);
  if (!rank || !lookup) notFound();

  const tops: Row[] = joinRepoRank(rank.items, lookup)
    .slice(0, 24)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const months = (heat?.cells ?? []).map(([period, total]) => {
    const month = Number(String(period).slice(5, 7));
    return { month, label: monthLabel(loc, month, "short"), gained: total };
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.gained));
  const total = months.reduce((sum, m) => sum + m.gained, 0);

  return (
    <>
      <Chrome locale={loc} t={t} />
      <JsonLd data={collectionLd(`${t.rankings.title} ${year}`, `/rankings/${year}`, loc)} />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs items={[{ label: t.nav.home, href: "/" }, { label: t.nav.rankings, href: "/rankings" }, { label: String(year) }]} />

        <section className="mt-5 grid gap-8 lg:grid-cols-[16rem_1fr]">
          <aside>
            <p className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.year.label}</p>
            <h1 className="mt-2 text-[clamp(2.6rem,7vw,4.5rem)] font-extrabold leading-none tracking-[-0.04em] text-on-surface">{year}</h1>
            <p className="mt-3 text-[0.95rem] text-on-surface-variant">
              <span className="font-semibold text-on-surface">{fmtStars(total)}</span> {t.year.gained}
            </p>
            <Link href="/rankings" className="mt-5 inline-block font-mono text-[0.78rem] text-primary-fixed-dim hover:underline">
              {t.nav.rankings}
            </Link>
          </aside>

          <div>
            <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {months.map((m, i) => (
                <Link
                  key={m.month}
                  href={`/rankings/${year}/${m.month}`}
                  className="rounded-2xl bg-surface-container px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-surface-container-high"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[0.78rem] text-on-surface-variant">{m.label}</span>
                    <span className="font-mono text-[0.82rem] font-semibold text-on-surface">+{fmtStars(m.gained)}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-container-high">
                    <div className="spine-bar h-full rounded-full bg-primary-container" style={{ "--w": m.gained / maxMonth, animationDelay: `${0.03 * i}s` } as CSSProperties} />
                  </div>
                </Link>
              ))}
            </div>

            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
              {t.year.top} {year}
            </h2>
            <RankingList rows={tops} locale={loc} />
          </div>
        </section>
      </main>
    </>
  );
}
