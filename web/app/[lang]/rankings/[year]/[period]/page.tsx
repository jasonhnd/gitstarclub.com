import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Heatmap } from "@/app/_explore/Heatmap";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars, monthLabel, monthYearLabel } from "@/lib/format";
import { collectionLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { parseLang, getDictionary, localePrefix, type Dict, type Locale } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  const p = currentUtcPeriods();
  return [{ year: String(p.year), period: String(p.month) }];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; year: string; period: string }> }): Promise<Metadata> {
  const { lang, year, period } = await params;
  const loc = parseLang(lang);
  if (!loc) return {};
  const week = /^W(\d{1,2})$/i.exec(period);
  const label = week ? `${year} Week ${Number(week[1])}` : `${monthLabel("en", Number(period), "long")} ${year}`;
  return pageMeta({
    title: `${label} GitHub Star Rankings`,
    description: `GitHub repositories ranked by stars gained in ${label}.`,
    path: `/rankings/${year}/${period}`,
    locale: loc,
  });
}

export default async function RankingsPeriodPage({ params }: { params: Promise<{ lang: string; year: string; period: string }> }) {
  const { lang, year: ys, period: ps } = await params;
  const loc = parseLang(lang);
  if (!loc) notFound();
  const year = Number(ys);
  const currentYear = currentUtcPeriods().year;
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) notFound();
  const t = await getDictionary(loc);

  const week = /^W(\d{1,2})$/i.exec(ps);
  if (week) return <WeekRankings loc={loc} t={t} year={year} week={Number(week[1])} />;

  const month = Number(ps);
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();
  return <MonthRankings loc={loc} t={t} year={year} month={month} />;
}

async function MonthRankings({ loc, t, year, month }: { loc: Locale; t: Dict; year: number; month: number }) {
  const lp = localePrefix(loc);
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const [flow, growth, newc, heat, lookup] = await Promise.all([
    getRank("month", period, "repo", "flow"),
    getRank("month", period, "repo", "growth"),
    getRank("month", period, "repo", "new"),
    getHeatmap("month", period),
    getReposLookup(),
  ]);
  if (!flow || !lookup) notFound();

  const most: Row[] = joinRepoRank(flow.items, lookup)
    .slice(0, 18)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
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

  return (
    <>
      <Chrome locale={loc} t={t} />
      <JsonLd data={collectionLd(monthYearLabel(loc, year, month), `${lp}/rankings/${year}/${month}`, loc)} />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { label: t.nav.home, href: lp },
            { label: t.nav.rankings, href: `${lp}/rankings` },
            { label: String(year), href: `${lp}/rankings/${year}` },
            { label: monthYearLabel(loc, year, month) },
          ]}
        />

        <PeriodHeader eyebrow={t.month.label} title={monthYearLabel(loc, year, month)} subtitle={`${t.month.gained} ${fmtStars(total)}`} backHref={`${lp}/rankings/${year}`} backLabel={String(year)} />

        {cells.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.month.daily}</h2>
            <Heatmap cells={cells} max={Math.max(1, ...cells.map((c) => c.gained))} columns={Math.min(16, cells.length)} square />
          </section>
        )}

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <section>
            <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.most}</h2>
            <RankingList rows={most} variant="gained" locale={loc} />
          </section>
          {fastest.length > 0 && (
            <section>
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.fastest}</h2>
              <RankingList rows={fastest} variant="rate" locale={loc} />
            </section>
          )}
          {newcomers.length > 0 && (
            <section>
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.newcomers}</h2>
              <RankingList rows={newcomers} variant="crossed" locale={loc} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

async function WeekRankings({ loc, t, year, week }: { loc: Locale; t: Dict; year: number; week: number }) {
  if (week < 1 || week > 53) notFound();
  const lp = localePrefix(loc);
  const period = `${year}-W${String(week).padStart(2, "0")}`;
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();
  const rows: Row[] = joinRepoRank(flow.items, lookup)
    .slice(0, 32)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));

  return (
    <>
      <Chrome locale={loc} t={t} />
      <JsonLd data={collectionLd(period, `${lp}/rankings/${year}/W${String(week).padStart(2, "0")}`, loc)} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { label: t.nav.home, href: lp },
            { label: t.nav.rankings, href: `${lp}/rankings` },
            { label: String(year), href: `${lp}/rankings/${year}` },
            { label: period },
          ]}
        />
        <PeriodHeader eyebrow={t.week.label} title={period} subtitle={t.week.top} backHref={`${lp}/rankings/${year}`} backLabel={String(year)} />
        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <RankingList rows={rows} variant="gained" locale={loc} />
        </section>
      </main>
    </>
  );
}

function PeriodHeader({ eyebrow, title, subtitle, backHref, backLabel }: { eyebrow: string; title: string; subtitle: string; backHref: string; backLabel: string }) {
  return (
    <section className="mt-5">
      <Link href={backHref} className="font-mono text-[0.78rem] text-primary-fixed-dim hover:underline">
        {backLabel}
      </Link>
      <p className="mt-5 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</p>
      <h1 className="mt-2 text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">{title}</h1>
      <p className="mt-3 max-w-[44ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">{subtitle}</p>
    </section>
  );
}
