import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import en from "@/lib/i18n/dictionaries/en";
import { getAllTime, getReposLookup, getOrgsLookup, joinRepoRank, joinOrgRank } from "@/lib/data";
import { fmtStars, monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { collectionLd } from "@/lib/jsonld";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";

const LOC = DEFAULT_LOCALE;

export const revalidate = false;

export async function generateMetadata(): Promise<Metadata> {
  const trackedYears = currentUtcPeriods().year - FIRST_YEAR + 1;
  return pageMeta({
    title: "All-Time GitHub Star Rankings — Most-Starred Repos & Orgs",
    description: `The all-time most-starred GitHub repositories and organizations. Top 100 by total stars across ${trackedYears} years.`,
    path: "/rankings",
    locale: "en",
  });
}

export default async function RankingsPage() {
  const loc = LOC;
  const periods = currentUtcPeriods();
  const [repoRank, orgRank, repoLk, orgLk] = await Promise.all([
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
      <Chrome />
      <JsonLd data={collectionLd(en.rankings.title, "/rankings", loc)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          <T path="rankings.title" />
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          <T path="rankings.subtitle" />
        </p>

        <section className="mt-[clamp(1.5rem,3vw,2.25rem)] grid gap-3 md:grid-cols-4">
          <HistoryLink href="/rankings" label="All-time" value={<T path="rankings.repositories" />} active />
          <HistoryLink href={`/rankings/${periods.year}`} label={<T path="year.label" />} value={String(periods.year)} />
          <HistoryLink href={`/rankings/${periods.year}/${periods.month}`} label={<T path="month.label" />} value={monthLabel(loc, periods.month, "short")} />
          <HistoryLink href={`/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`} label={<T path="week.label" />} value={periods.weekPeriod} />
        </section>

        <section className="mt-[clamp(1rem,2vw,1.5rem)]">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: periods.year - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)
              .reverse()
              .map((year) => (
                <Link
                  key={year}
                  href={`/rankings/${year}`}
                  className="rounded-full bg-surface-container-high px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  {year}
                </Link>
              ))}
          </div>
        </section>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-x-10 gap-y-10 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
              <T path="rankings.repositories" />
            </h2>
            <RankingList rows={repoRows} variant="total" locale={loc} />
          </section>
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
              <T path="rankings.organizations" />
            </h2>
            <ol className="flex flex-col">
              {orgs.map((o, i) => (
                <li key={o.login}>
                  <Link
                    href={`/o/${o.login}`}
                    className="group flex min-h-[4.25rem] animate-rise items-center gap-2 overflow-hidden rounded-2xl px-2.5 py-2.5 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-on-surface/5 active:scale-[0.985] sm:gap-4 sm:px-3 sm:py-3"
                    style={{ animationDelay: `${0.04 * Math.min(i, 12)}s` } as CSSProperties}
                  >
                    <span className="w-7 shrink-0 text-right text-[1.25rem] font-extrabold tabular-nums text-primary-fixed-dim sm:w-9 sm:text-[1.5rem]">{o.rank}</span>
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <span className="truncate font-mono text-[0.95rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">{o.login}</span>
                      <span className="mt-1 inline-block w-fit max-w-full truncate whitespace-nowrap rounded-full bg-surface-container-high px-2 py-0.5 text-[0.68rem] font-medium text-on-surface-variant">
                        {o.repo_count} <T path="rankings.repos" />
                      </span>
                    </div>
                    <div className="shrink-0 text-right text-[0.95rem] font-extrabold tabular-nums text-on-surface sm:text-[1.05rem]">{fmtStars(o.current_stars_sum)}★</div>
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

function HistoryLink({ href, label, value, active = false }: { href: string; label: ReactNode; value: ReactNode; active?: boolean }) {
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
