import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { Heatmap } from "@/app/_explore/Heatmap";
import { JsonLd } from "@/app/_explore/JsonLd";
import { Narrative } from "@/app/_explore/Narrative";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { ShareButton } from "@/app/_explore/ShareButton";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { buildNarrative } from "@/lib/narrative";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { fmtStars, monthLabel, monthYearLabel } from "@/lib/format";
import { getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { pageMeta } from "@/lib/seo";
import { buildWeeklyMoversSnippet } from "@/lib/shareable-snippets";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { repositoryTableLabels } from "./routing";
import {
  answerCapsuleLabels,
  buildLocalizedRankingCapsule,
  buildLocalizedRankingFaqs,
  detailText,
  fill,
  shareButtonLabels,
  shareableSnippetLabels,
} from "./detail-copy";
import { generateCoreLocaleStaticParams } from "./routing";

type YearParam = { year: string };
type PeriodParam = { year: string; period: string };

export function generateRankingYearStaticParams(): YearParam[] {
  return [{ year: String(currentUtcPeriods().year) }];
}

export function generateLocalizedRankingYearStaticParams(): Array<YearParam & { locale: Locale }> {
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => generateRankingYearStaticParams().map((param) => ({ locale, ...param })));
}

export function generateRankingPeriodStaticParams(): PeriodParam[] {
  const periods = currentUtcPeriods();
  return [
    { year: String(periods.year), period: String(periods.month) },
    { year: String(periods.week.year), period: `W${String(periods.week.week).padStart(2, "0")}` },
  ];
}

export function generateLocalizedRankingPeriodStaticParams(): Array<PeriodParam & { locale: Locale }> {
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => generateRankingPeriodStaticParams().map((param) => ({ locale, ...param })));
}

export async function generateRankingYearMetadata(locale: Locale, yearValue: string): Promise<Metadata> {
  const text = detailText(locale);
  return pageMeta({
    title: fill(text.yearMetaTitle, { year: yearValue }),
    description: fill(text.yearMetaDescription, { year: yearValue }),
    path: `/rankings/${yearValue}`,
    locale,
    ogImage: `/rankings/${yearValue}/opengraph-image`,
  });
}

export async function generateRankingPeriodMetadata(locale: Locale, params: PeriodParam): Promise<Metadata> {
  const text = detailText(locale);
  const label = periodLabel(locale, params.year, params.period);
  return pageMeta({
    title: fill(text.periodMetaTitle, { label }),
    description: fill(text.periodMetaDescription, { label }),
    path: rankingPeriodPath(params.year, params.period),
    locale,
    ogImage: `/rankings/${params.year}/${params.period}/opengraph-image`,
  });
}

export async function RankingsYearPageView({ locale, year: yearValue }: { locale: Locale; year: string }) {
  const t = await getDictionary(locale);
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const year = Number(yearValue);
  const currentYear = currentUtcPeriods().year;
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > currentYear) notFound();

  const [rank, heat, lookup] = await Promise.all([
    getRank("year", String(year), "repo", "flow"),
    getHeatmap("year", String(year)),
    getReposLookup(),
  ]);
  if (!rank || !lookup) notFound();

  const rankRows: Row[] = joinRepoRank(rank.items, lookup).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const asOf = resolveDataAsOfLabel(rank.meta.generated_at, heat?.meta.generated_at);
  const pagePath = `/rankings/${year}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const dateModified = resolveDataAsOfValue(rank.meta.generated_at, heat?.meta.generated_at);
  const title = fill(text.yearMetaTitle, { year });
  const tableLabels = repositoryTableLabels(t);
  const dataset = datasetLd({
    name: fill(text.rankingDatasetName, { label: String(year) }),
    path: routePath,
    locale: language,
    description: fill(text.rankingDatasetDescription, { label: String(year) }),
    dateModified,
  });
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: rankRows, metric: "gained" }) : null;
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: rankRows, metric: "gained" });
  const tops = rankRows.slice(0, 24);
  const months = (heat?.cells ?? []).map(([period, total]) => {
    const month = Number(String(period).slice(5, 7));
    return { month, label: monthLabel(locale, month, "short"), gained: total };
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.gained));
  const total = months.reduce((sum, m) => sum + m.gained, 0);

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.rankingCollectionName, { label: String(year) }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.rankingItemListName, { label: String(year) }),
          routePath,
          language,
          rankRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "nav.rankings", href: "/rankings" }, { label: String(year) }]} />

        <section className="mt-5 grid gap-8 lg:grid-cols-[16rem_1fr]">
          <aside>
            <p className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.year.label}</p>
            <h1 className="mt-2 text-[clamp(2.6rem,7vw,4.5rem)] font-extrabold leading-none tracking-[-0.04em] text-on-surface">{year}</h1>
            <p className="mt-3 text-[0.95rem] text-on-surface-variant">
              <span className="font-semibold text-on-surface">{fmtStars(total)}</span> {t.year.gained}
            </p>
            <Link href={href("/rankings")} className="text-readable-gold mt-5 inline-block font-mono text-[0.78rem] hover:underline">
              {t.nav.rankings}
            </Link>
            {rankRows.length > tops.length && (
              <Link href="#complete-ranking" className="text-readable-gold mt-3 block font-mono text-[0.78rem] hover:underline">
                {text.completeRanking}
              </Link>
            )}
            <div className="mt-6">
              <ShareButton text={title} labels={shareButtonLabels(locale, t)} />
            </div>
          </aside>

          <div>
            {capsule && <AnswerCapsule capsule={capsule} className="mb-6" labels={answerCapsuleLabels(locale, t)} />}

            <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {months.map((m, i) => (
                <Link
                  key={m.month}
                  href={href(`/rankings/${year}/${m.month}`)}
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
            <RankingList rows={tops} locale={locale} tableCaption={fill(text.repositoryRankingsCaption, { label: String(year) })} labels={tableLabels} />
            {rankRows.length > tops.length && (
              <section id="complete-ranking" className="mt-[clamp(2rem,4vw,3rem)] scroll-mt-24">
                <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{text.completeRanking}</h2>
                <RankingList rows={rankRows} locale={locale} tableCaption={fill(text.completeRepositoryRankingsCaption, { label: String(year) })} labels={tableLabels} />
              </section>
            )}
            <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
          </div>
        </section>
      </main>
    </>
  );
}

export async function RankingsPeriodPageView({ locale, year: yearValue, period: periodValue }: { locale: Locale; year: string; period: string }) {
  const t = await getDictionary(locale);
  const year = Number(yearValue);
  const periods = currentUtcPeriods();
  const maxYear = Math.max(periods.year, periods.week.year);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > maxYear) notFound();
  const week = /^W(\d{1,2})$/i.exec(periodValue);
  if (week) return <WeekRankings locale={locale} t={t} year={year} week={Number(week[1])} />;

  const month = Number(periodValue);
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();
  return <MonthRankings locale={locale} t={t} year={year} month={month} />;
}

async function MonthRankings({ locale, t, year, month }: { locale: Locale; t: Dict; year: number; month: number }) {
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
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
  const pageLabel = monthYearLabel(locale, year, month);
  const title = fill(text.periodMetaTitle, { label: pageLabel });
  const asOf = resolveDataAsOfLabel(flow.meta.generated_at, heat?.meta.generated_at);
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: flowRows, metric: "gained" }) : null;
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: flowRows, metric: "gained" });
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
    labels: {
      en: monthYearLabel("en", year, month),
      ja: monthYearLabel("ja", year, month),
      zh: monthYearLabel("zh", year, month),
      "zh-TW": monthYearLabel("zh-TW", year, month),
      ko: monthYearLabel("ko", year, month),
      es: monthYearLabel("es", year, month),
      fr: monthYearLabel("fr", year, month),
    },
    topGainers: most.slice(0, 3).map((r) => ({ full_name: `${r.owner}/${r.name}`, gained: r.gained ?? 0 })),
    fastest: fastest.slice(0, 1).map((r) => ({ full_name: `${r.owner}/${r.name}`, rate: Math.round(r.rate ?? 0) })),
    newcomerCount: newc?.items.length ?? 0,
    newcomers: newcomers.slice(0, 2).map((r) => `${r.owner}/${r.name}`),
  });
  const pagePath = `/rankings/${year}/${month}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const tableLabels = repositoryTableLabels(t);
  const dateModified = resolveDataAsOfValue(flow.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at);
  const dataset = datasetLd({
    name: fill(text.rankingDatasetName, { label: pageLabel }),
    path: routePath,
    locale: language,
    description: fill(text.rankingDatasetDescription, { label: pageLabel }),
    dateModified,
  });

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.rankingCollectionName, { label: pageLabel }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.rankingItemListName, { label: pageLabel }),
          routePath,
          language,
          flowRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          locale={locale}
          dictionary={t}
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.rankings", href: "/rankings" },
            { label: String(year), href: `/rankings/${year}` },
            { label: pageLabel },
          ]}
        />

        <PeriodHeader
          eyebrow={t.month.label}
          title={pageLabel}
          subtitle={
            <>
              {t.month.gained} {fmtStars(total)}
            </>
          }
          backHref={href(`/rankings/${year}`)}
          backLabel={String(year)}
          completeHref={flowRows.length > most.length ? "#complete-ranking" : undefined}
          completeLabel={text.completeRanking}
          shareText={title}
          shareLabels={shareButtonLabels(locale, t)}
        />

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={answerCapsuleLabels(locale, t)} />}

        {narrative && (
          <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)]">
            <p className="mb-3 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.month.narrative}</p>
            <Narrative texts={narrative} locale={locale} />
          </section>
        )}

        {cells.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.month.daily}</h2>
            <Heatmap cells={cells} max={Math.max(1, ...cells.map((c) => c.gained))} columns={Math.min(16, cells.length)} square />
          </section>
        )}

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <section className="min-w-0">
            <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.most}</h2>
            <RankingList rows={most} variant="gained" locale={locale} tableCaption={fill(text.gainedCaption, { label: pageLabel })} labels={tableLabels} />
          </section>
          {fastest.length > 0 && (
            <section className="min-w-0">
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.fastest}</h2>
              <RankingList rows={fastest} variant="rate" locale={locale} tableCaption={fill(text.growthCaption, { label: pageLabel })} labels={tableLabels} />
            </section>
          )}
          {newcomers.length > 0 && (
            <section className="min-w-0">
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.month.newcomers}</h2>
              <RankingList rows={newcomers} variant="crossed" locale={locale} tableCaption={fill(text.crossedCaption, { label: pageLabel })} labels={tableLabels} />
            </section>
          )}
        </div>

        {flowRows.length > most.length && (
          <section id="complete-ranking" className="mt-[clamp(2rem,4vw,3rem)] min-w-0 scroll-mt-24">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{text.completeRanking}</h2>
            <RankingList rows={flowRows} variant="gained" locale={locale} tableCaption={fill(text.completeRepositoryRankingsCaption, { label: pageLabel })} labels={tableLabels} />
          </section>
        )}
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

async function WeekRankings({ locale, t, year, week }: { locale: Locale; t: Dict; year: number; week: number }) {
  if (week < 1 || week > 53) notFound();
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const period = `${year}-W${String(week).padStart(2, "0")}`;
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();
  const rankRows: Row[] = joinRepoRank(flow.items, lookup).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const title = fill(text.periodMetaTitle, { label: period });
  const asOf = resolveDataAsOfLabel(flow.meta.generated_at);
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: rankRows, metric: "gained" }) : null;
  const pagePath = `/rankings/${year}/W${String(week).padStart(2, "0")}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const snippet = buildWeeklyMoversSnippet({ locale, period, asOf, rows: rankRows, path: routePath });
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: rankRows, metric: "gained" });
  const rows = rankRows.slice(0, 32);
  const tableLabels = repositoryTableLabels(t);
  const dateModified = resolveDataAsOfValue(flow.meta.generated_at);
  const dataset = datasetLd({
    name: fill(text.rankingDatasetName, { label: period }),
    path: routePath,
    locale: language,
    description: fill(text.rankingDatasetDescription, { label: period }),
    dateModified,
  });

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      <JsonLd data={collectionLd(fill(text.rankingCollectionName, { label: period }), routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          fill(text.rankingItemListName, { label: period }),
          routePath,
          language,
          rankRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          locale={locale}
          dictionary={t}
          items={[
            { path: "nav.home", href: "/" },
            { path: "nav.rankings", href: "/rankings" },
            { label: String(year), href: `/rankings/${year}` },
            { label: period },
          ]}
        />
        <PeriodHeader
          eyebrow={t.week.label}
          title={period}
          subtitle={t.week.top}
          backHref={href(`/rankings/${year}`)}
          backLabel={String(year)}
          completeHref={rankRows.length > rows.length ? "#complete-ranking" : undefined}
          completeLabel={text.completeRanking}
          shareText={title}
          shareLabels={shareButtonLabels(locale, t)}
        />
        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={answerCapsuleLabels(locale, t)} />}
        {snippet && <ShareableSnippet snippet={snippet} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={shareableSnippetLabels(locale)} />}
        <section className="mt-[clamp(2rem,4vw,3rem)] min-w-0">
          <RankingList rows={rows} variant="gained" locale={locale} tableCaption={fill(text.gainedCaption, { label: period })} labels={tableLabels} />
        </section>
        {rankRows.length > rows.length && (
          <section id="complete-ranking" className="mt-[clamp(2rem,4vw,3rem)] min-w-0 scroll-mt-24">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{text.completeRanking}</h2>
            <RankingList rows={rankRows} variant="gained" locale={locale} tableCaption={fill(text.completeRepositoryRankingsCaption, { label: period })} labels={tableLabels} />
          </section>
        )}
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
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
  completeLabel,
  shareText,
  shareLabels,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  backHref: string;
  backLabel: string;
  completeHref?: string;
  completeLabel: string;
  shareText: string;
  shareLabels: { label: string; copied: string; onX: string; opensNewTab: string };
}) {
  return (
    <section className="mt-5">
      <Link href={backHref} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
        {backLabel}
      </Link>
      {completeHref && (
        <Link href={completeHref} className="text-readable-gold ml-4 font-mono text-[0.78rem] hover:underline">
          {completeLabel}
        </Link>
      )}
      <p className="mt-5 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{eyebrow}</p>
      <h1 className="mt-2 text-[clamp(2rem,6vw,3.8rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">{title}</h1>
      <p className="mt-3 max-w-[44ch] text-[clamp(0.95rem,1.6vw,1.1rem)] text-on-surface-variant">{subtitle}</p>
      <div className="mt-5">
        <ShareButton text={shareText} labels={shareLabels} />
      </div>
    </section>
  );
}

function rankingPeriodPath(yearValue: string, rawPeriod: string): string {
  const year = Number(yearValue);
  if (!Number.isInteger(year)) return `/rankings/${yearValue}/${rawPeriod}`;
  const week = /^W(\d{1,2})$/i.exec(rawPeriod);
  if (week) return `/rankings/${year}/W${String(Number(week[1])).padStart(2, "0")}`;
  const month = Number(rawPeriod);
  return Number.isInteger(month) ? `/rankings/${year}/${month}` : `/rankings/${year}/${rawPeriod}`;
}

function periodLabel(locale: Locale, yearValue: string, rawPeriod: string): string {
  const year = Number(yearValue);
  const week = /^W(\d{1,2})$/i.exec(rawPeriod);
  if (week) return `${year}-W${String(Number(week[1])).padStart(2, "0")}`;
  const month = Number(rawPeriod);
  return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12 ? monthYearLabel(locale, year, month) : `${yearValue}/${rawPeriod}`;
}
