import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Heatmap } from "@/app/_explore/Heatmap";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { ShareButton } from "@/app/_explore/ShareButton";
import { Narrative } from "@/app/_explore/Narrative";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { buildNarrative } from "@/lib/narrative";
import { fmtStars, monthLabel, monthYearLabel } from "@/lib/format";
import { collectionLd, itemListLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { buildRankingCapsule, dataAsOfLabel } from "@/lib/geo-capsules";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/lib/i18n";

const LOC = DEFAULT_LOCALE;

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  const p = currentUtcPeriods();
  return [{ year: String(p.year), period: String(p.month) }];
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; period: string }> }): Promise<Metadata> {
  const { year, period } = await params;
  const week = /^W(\d{1,2})$/i.exec(period);
  const label = week ? `${year} Week ${Number(week[1])}` : `${monthLabel("en", Number(period), "long")} ${year}`;
  return pageMeta({
    title: `${label} GitHub Star Rankings`,
    description: `GitHub repositories ranked by stars gained in ${label}.`,
    path: `/rankings/${year}/${period}`,
    locale: "en",
    ogImage: `/rankings/${year}/${period}/opengraph-image`,
  });
}

export default async function RankingsPeriodPage({ params }: { params: Promise<{ year: string; period: string }> }) {
  const { year: ys, period: ps } = await params;
  const loc = LOC;
  const year = Number(ys);
  const currentYear = currentUtcPeriods().year;
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) notFound();
  const week = /^W(\d{1,2})$/i.exec(ps);
  if (week) return <WeekRankings loc={loc} year={year} week={Number(week[1])} />;

  const month = Number(ps);
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();
  return <MonthRankings loc={loc} year={year} month={month} />;
}

async function MonthRankings({ loc, year, month }: { loc: Locale; year: number; month: number }) {
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const [flow, growth, newc, heat, lookup] = await Promise.all([
    getRank("month", period, "repo", "flow"),
    getRank("month", period, "repo", "growth"),
    getRank("month", period, "repo", "new"),
    getHeatmap("month", period),
    getReposLookup(),
  ]);
  if (!flow || !lookup) notFound();

  const flowRows: Row[] = joinRepoRank(flow.items, lookup).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const capsule = buildRankingCapsule({
    title: `${monthYearLabel(loc, year, month)} GitHub Star Rankings`,
    asOf: dataAsOfLabel(flow.meta.generated_at, heat?.meta.generated_at),
    rows: flowRows,
    metric: "gained",
  });
  const most = flowRows.slice(0, 18);
  const fastest: Row[] = growth
    ? joinRepoRank(growth.items, lookup)
        .slice(0, 10)
        .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars, rate: r.rate }))
    : [];
  const newcomers: Row[] = newc
    ? joinRepoRank(newc.items, lookup)
        .slice(0, 10)
        .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars, crossedDay: r.date ? Number(r.date.slice(8, 10)) : undefined }))
    : [];
  const cells = (heat?.cells ?? []).map(([date, total]) => ({ label: String(Number(String(date).slice(8, 10))), gained: total }));
  const total = cells.reduce((sum, c) => sum + c.gained, 0);
  const narrative = buildNarrative({
    labels: Object.fromEntries(LOCALES.map((locale) => [locale, monthYearLabel(locale, year, month)])) as Record<Locale, string>,
    topGainers: most.slice(0, 3).map((r) => ({ full_name: `${r.owner}/${r.name}`, gained: r.gained ?? 0 })),
    fastest: fastest.slice(0, 1).map((r) => ({ full_name: `${r.owner}/${r.name}`, rate: Math.round(r.rate ?? 0) })),
    newcomerCount: newc?.items.length ?? 0,
    newcomers: newcomers.slice(0, 2).map((r) => `${r.owner}/${r.name}`),
  });

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(monthYearLabel(loc, year, month), `/rankings/${year}/${month}`, loc)} />
      <JsonLd
        data={itemListLd(
          `${monthYearLabel(loc, year, month)} GitHub repository rankings`,
          `/rankings/${year}/${month}`,
          loc,
          flowRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.rankings", href: "/rankings" },
            { label: String(year), href: `/rankings/${year}` },
            { label: monthYearLabel(loc, year, month) },
          ]}
        />

        <PeriodHeader
          eyebrow={<T path="month.label" />}
          title={monthYearLabel(loc, year, month)}
          subtitle={
            <>
              <T path="month.gained" /> {fmtStars(total)}
            </>
          }
          backHref={`/rankings/${year}`}
          backLabel={String(year)}
          completeHref={flowRows.length > most.length ? "#complete-ranking" : undefined}
          shareText={`${monthYearLabel(loc, year, month)} — GitHub star rankings`}
        />

        <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" />

        {narrative && (
          <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)]">
            <p className="mb-3 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">
              <T path="month.narrative" />
            </p>
            <Narrative texts={narrative} />
          </section>
        )}

        {cells.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
              <T path="month.daily" />
            </h2>
            <Heatmap cells={cells} max={Math.max(1, ...cells.map((c) => c.gained))} columns={Math.min(16, cells.length)} square />
          </section>
        )}

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <section className="min-w-0">
            <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">
              <T path="month.most" />
            </h2>
            <RankingList rows={most} variant="gained" locale={loc} />
          </section>
          {fastest.length > 0 && (
            <section className="min-w-0">
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">
                <T path="month.fastest" />
              </h2>
              <RankingList rows={fastest} variant="rate" locale={loc} />
            </section>
          )}
          {newcomers.length > 0 && (
            <section className="min-w-0">
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">
                <T path="month.newcomers" />
              </h2>
              <RankingList rows={newcomers} variant="crossed" locale={loc} />
            </section>
          )}
        </div>

        {flowRows.length > most.length && (
          <section id="complete-ranking" className="mt-[clamp(2rem,4vw,3rem)] min-w-0 scroll-mt-24">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">Complete ranking</h2>
            <RankingList rows={flowRows} variant="gained" locale={loc} />
          </section>
        )}
      </main>
    </>
  );
}

async function WeekRankings({ loc, year, week }: { loc: Locale; year: number; week: number }) {
  if (week < 1 || week > 53) notFound();
  const period = `${year}-W${String(week).padStart(2, "0")}`;
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();
  const rankRows: Row[] = joinRepoRank(flow.items, lookup).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const capsule = buildRankingCapsule({
    title: `${period} GitHub Star Rankings`,
    asOf: dataAsOfLabel(flow.meta.generated_at),
    rows: rankRows,
    metric: "gained",
  });
  const rows = rankRows.slice(0, 32);

  return (
    <>
      <Chrome />
      <JsonLd data={collectionLd(period, `/rankings/${year}/W${String(week).padStart(2, "0")}`, loc)} />
      <JsonLd
        data={itemListLd(
          `${period} GitHub repository rankings`,
          `/rankings/${year}/W${String(week).padStart(2, "0")}`,
          loc,
          rankRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.rankings", href: "/rankings" },
            { label: String(year), href: `/rankings/${year}` },
            { label: period },
          ]}
        />
        <PeriodHeader
          eyebrow={<T path="week.label" />}
          title={period}
          subtitle={<T path="week.top" />}
          backHref={`/rankings/${year}`}
          backLabel={String(year)}
          completeHref={rankRows.length > rows.length ? "#complete-ranking" : undefined}
          shareText={`${period} — GitHub star rankings`}
        />
        <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" />
        <section className="mt-[clamp(2rem,4vw,3rem)] min-w-0">
          <RankingList rows={rows} variant="gained" locale={loc} />
        </section>
        {rankRows.length > rows.length && (
          <section id="complete-ranking" className="mt-[clamp(2rem,4vw,3rem)] min-w-0 scroll-mt-24">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">Complete ranking</h2>
            <RankingList rows={rankRows} variant="gained" locale={loc} />
          </section>
        )}
      </main>
    </>
  );
}

function PeriodHeader({
  eyebrow,
  title,
  subtitle,
  backHref,
  backLabel,
  completeHref,
  shareText,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  backHref: string;
  backLabel: string;
  completeHref?: string;
  shareText: string;
}) {
  return (
    <section className="mt-5">
      <Link href={backHref} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
        {backLabel}
      </Link>
      {completeHref && (
        <Link href={completeHref} className="text-readable-gold ml-4 font-mono text-[0.78rem] hover:underline">
          Complete ranking
        </Link>
      )}
      <p className="mt-5 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</p>
      <h1 className="mt-2 text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">{title}</h1>
      <p className="mt-3 max-w-[44ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">{subtitle}</p>
      <div className="mt-5">
        <ShareButton text={shareText} />
      </div>
    </section>
  );
}
