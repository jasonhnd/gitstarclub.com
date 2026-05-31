import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { getHotSnapshot, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { webSiteLd } from "@/lib/jsonld";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    absoluteTitle: true,
    title: "GitHub Star History & Trends — A Chronicle of Open Source · gitstarclub",
    description:
      "Explore 11 years of GitHub star history across 5,200+ projects with ≥10k stars. Yearly & monthly trending, all-time rankings, and per-repo star timelines.",
    path: "/",
    locale: loc,
  });
}

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const t = await getDictionary(loc);
  const lp = localePrefix(loc);

  const [snap, lookup] = await Promise.all([getHotSnapshot(), getReposLookup()]);
  const spine = snap?.home.year_spine ?? [];
  const maxTotal = Math.max(1, ...spine.map(([, total]) => total));
  const thisMonth: Row[] =
    snap && lookup
      ? joinRepoRank(snap.home.current_month_top.flow.slice(0, 3), lookup).map((r) => ({
          owner: r.owner,
          name: r.name,
          lang: r.language,
          gained: r.value,
          total: r.current_stars,
        }))
      : [];

  return (
    <>
      <Chrome locale={loc} t={t} />
      <JsonLd data={webSiteLd(loc, lp)} />
      <main className={`mx-auto w-full max-w-[68rem] flex-1 py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <h1 className="max-w-[16ch] animate-rise text-[clamp(2.4rem,7vw,5rem)] font-extrabold leading-[1.0] tracking-[-0.04em]">
          {t.home.heroPre}
          <span className="hl">{t.home.heroAccent}</span>
          {t.home.heroPost}
        </h1>
        <p
          className="mt-5 max-w-[46ch] animate-rise text-[clamp(1rem,1.7vw,1.25rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          {t.home.lead}
        </p>

        {spine.length > 0 && (
          <section className="mt-[clamp(2.5rem,6vw,4.5rem)]" aria-label={t.home.perYear}>
            <div
              className="grid h-[clamp(200px,32vw,340px)] items-end gap-1 sm:gap-[1vw]"
              style={{ gridTemplateColumns: `repeat(${spine.length}, minmax(0, 1fr))` }}
            >
              {spine.map(([year, total], i) => (
                <Link
                  key={year}
                  href={`${lp}/${year}`}
                  aria-label={`${year}: ${fmtStars(total)} ${t.home.gainedAria}`}
                  className="group flex h-full min-w-0 flex-col items-center justify-end gap-3 transition-transform duration-200 ease-[var(--ease-spring)] hover:-translate-y-1.5 active:scale-[0.97]"
                >
                  <span className="hidden font-mono text-[0.72rem] tabular-nums text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                    {fmtStars(total)}
                  </span>
                  <div className="flex w-full flex-1 items-end">
                    <div
                      className={`spine-bar-y w-full rounded-t-xl ${total === maxTotal ? "bg-primary-fixed-dim" : "bg-primary-container"} transition-[filter] duration-200 group-hover:brightness-105`}
                      style={{ "--h": total / maxTotal, height: "100%", animationDelay: `${0.04 * i}s` } as CSSProperties}
                    />
                  </div>
                  <span className="font-mono text-[0.7rem] tabular-nums text-on-surface-variant transition-colors group-hover:text-on-surface sm:text-[0.8rem]">
                    {`'${String(year).slice(2)}`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {thisMonth.length > 0 && (
          <section className="mt-[clamp(2.5rem,5vw,4rem)] max-w-[42rem]">
            <h2 className="mb-2 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              {t.home.thisMonth}
            </h2>
            <RankingList rows={thisMonth} locale={loc} />
          </section>
        )}
      </main>
    </>
  );
}
