import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { getAllTime, getReposLookup, getOrgsLookup, joinRepoRank, joinOrgRank } from "@/lib/data";
import { fmtStars, monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { collectionLd } from "@/lib/jsonld";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    title: "All-Time GitHub Star Rankings — Most-Starred Repos & Orgs",
    description: "The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across 11 years.",
    path: "/rankings",
    locale: loc,
  });
}

export default async function RankingsPage({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const lp = localePrefix(loc);
  const periods = currentUtcPeriods();
  const [t, repoRank, orgRank, repoLk, orgLk] = await Promise.all([
    getDictionary(loc),
    getAllTime("repo"),
    getAllTime("org"),
    getReposLookup(),
    getOrgsLookup(),
  ]);
  const repoRows: Row[] =
    repoRank && repoLk
      ? joinRepoRank(repoRank.items, repoLk).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars }))
      : [];
  const orgs = orgRank && orgLk ? joinOrgRank(orgRank.items, orgLk) : [];

  return (
    <>
      <Chrome locale={loc} t={t} />
      <JsonLd data={collectionLd(t.rankings.title, `${lp}/rankings`, loc)} />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          {t.rankings.title}
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">{t.rankings.subtitle}</p>

        <section className="mt-[clamp(1.5rem,3vw,2.25rem)] grid gap-3 md:grid-cols-4">
          <HistoryLink href={`${lp}/rankings`} label="All-time" value={t.rankings.repositories} active />
          <HistoryLink href={`${lp}/rankings/${periods.year}`} label={t.year.label} value={String(periods.year)} />
          <HistoryLink href={`${lp}/rankings/${periods.year}/${periods.month}`} label={t.month.label} value={monthLabel(loc, periods.month, "short")} />
          <HistoryLink href={`${lp}/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`} label={t.week.label} value={periods.weekPeriod} />
        </section>

        <section className="mt-[clamp(1rem,2vw,1.5rem)]">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: periods.year - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)
              .reverse()
              .map((year) => (
                <Link
                  key={year}
                  href={`${lp}/rankings/${year}`}
                  className="rounded-full bg-surface-container-high px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  {year}
                </Link>
              ))}
          </div>
        </section>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-x-10 gap-y-10 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.repositories}</h2>
            <RankingList rows={repoRows} variant="total" locale={loc} />
          </section>
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.organizations}</h2>
            <ol className="flex flex-col">
              {orgs.map((o, i) => (
                <li key={o.login}>
                  <Link
                    href={`${lp}/o/${o.login}`}
                    className="group flex animate-rise items-center gap-4 rounded-2xl px-3 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-on-surface/5 active:scale-[0.985]"
                    style={{ animationDelay: `${0.04 * i}s` } as CSSProperties}
                  >
                    <span className="w-9 shrink-0 text-right text-[1.5rem] font-extrabold tabular-nums text-primary-fixed-dim">{o.rank}</span>
                    <div className="min-w-0 flex-1">
                      <span className="truncate font-mono text-[0.95rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">{o.login}</span>
                      <div className="font-mono text-[0.68rem] text-on-surface-variant">{o.repo_count} {t.rankings.repos}</div>
                    </div>
                    <div className="shrink-0 text-right text-[1.05rem] font-extrabold tabular-nums text-on-surface">{fmtStars(o.current_stars_sum)}★</div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
    </>
  );
}

function HistoryLink({ href, label, value, active = false }: { href: string; label: string; value: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-2xl px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 ${
        active ? "bg-primary-container text-on-primary-container" : "bg-surface-container text-on-surface hover:bg-surface-container-high"
      }`}
    >
      <span className="block font-mono text-[0.7rem] uppercase tracking-wider opacity-75">{label}</span>
      <span className="mt-1 block truncate text-[1rem] font-extrabold">{value}</span>
    </Link>
  );
}
