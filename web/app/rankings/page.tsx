import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { OrganizationRankingTable } from "@/app/_explore/SemanticDataTable";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import en from "@/lib/i18n/dictionaries/en";
import { getAllTime, getReposLookup, getOrgsLookup, joinRepoRank, joinOrgRank } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { buildAllTimeRankingCapsule, resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { buildAllTimeRankingFaqs } from "@/lib/geo-faq";
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
  const asOf = resolveDataAsOfLabel(repoRank?.meta.generated_at, orgRank?.meta.generated_at);
  const dateModified = resolveDataAsOfValue(repoRank?.meta.generated_at, orgRank?.meta.generated_at);
  const dataset = datasetLd({
    name: "GitStarClub All-Time Rankings Dataset",
    path: "/rankings",
    locale: loc,
    description: "All-time GitHub repository and organization rankings generated from precomputed Blob rank JSON.",
    dateModified,
  });
  const capsule = asOf ? buildAllTimeRankingCapsule({ asOf, repoRows, orgRows: orgs }) : null;
  const faqItems = buildAllTimeRankingFaqs({ asOf, repoRows, orgRows: orgs });

  return (
    <>
      <Chrome locale={loc} canonicalPath="/rankings" />
      <JsonLd data={collectionLd(en.rankings.title, "/rankings", loc, { dateModified, about: datasetRef("/rankings") })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          `${en.rankings.title} repositories`,
          "/rankings",
          loc,
          repoRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <JsonLd
        data={itemListLd(
          `${en.rankings.title} organizations`,
          "/rankings",
          loc,
          orgs.map((org) => ({ name: org.login, path: `/o/${org.login}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          <T path="rankings.title" />
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          <T path="rankings.subtitle" />
        </p>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" />}

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
            <RankingList rows={repoRows} variant="total" locale={loc} tableCaption="All-time GitHub repository rankings" />
          </section>
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
              <T path="rankings.organizations" />
            </h2>
            <OrganizationRankingTable rows={orgs} caption="All-time GitHub organization rankings" />
          </section>
        </div>

        <FaqBlock items={faqItems} path="/rankings" locale={loc} />
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
      <span className={`block font-mono text-[0.7rem] uppercase tracking-wider ${active ? "" : "opacity-75"}`}>{label}</span>
      <span className="mt-1 block truncate text-[1rem] font-extrabold">{value}</span>
    </Link>
  );
}
