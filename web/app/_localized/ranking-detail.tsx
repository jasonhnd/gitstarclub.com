import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { Heatmap } from "@/app/_explore/Heatmap";
import { JsonLd } from "@/app/_explore/JsonLd";
import { Narrative } from "@/app/_explore/Narrative";
import { PageHero } from "@/app/_explore/PageHero";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { RelatedPages } from "@/app/_explore/RelatedPages";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { ShareButton } from "@/app/_explore/ShareButton";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { buildNarrative } from "@/lib/narrative";
import { currentUtcPeriods, FIRST_YEAR, isoWeek } from "@/lib/periods";
import { fmtStars, formatInteger, monthLabel, monthYearLabel } from "@/lib/format";
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
type NewcomerRow = Row & { crossedDate?: string };
type HeatmapCell = { label: string; gained: number; href?: string };
type PeriodNavLink = { href: string; label: string; eyebrow: string };

const RANKING_DETAIL_ROW_LIMIT = 100;
const PRIMARY_PANEL_LIMIT = 18;
const SECONDARY_PANEL_LIMIT = 10;

const DETAIL_UI = {
  permanentArchive: "Permanent archive",
  yearHero:
    "Permanent {year} archive of tracked GitHub repositories ranked by stars gained, with month-by-month movement from precomputed rank and heatmap JSON.",
  monthHero:
    "Permanent archive for {label}, ranking tracked GitHub repositories by stars gained during that calendar month from precomputed rank and heatmap JSON.",
  weekHero:
    "Permanent archive for exact ISO week {label}, ranking tracked GitHub repositories by stars gained during that week from precomputed rank JSON.",
  mostStarsAdded: "Most stars added",
  fastestGrowth: "Fastest growth",
  newcomers: "Newcomers",
  monthlyMovement: "Monthly movement",
  dailyMovement: "Daily movement",
  topRepositoryLinks: "Top repository links",
  periodNavigation: "Period navigation",
  relatedTitle: "Related ranking links",
  relatedDescription: "Permanent archive routes and current activity views connected to this ranking period.",
  visibleRows: "Visible rows",
  starsAdded: "Stars added",
  noRankingRows: "Ranking data is waiting for the next published recompute.",
  noMovement: "Movement data is waiting for the next published recompute.",
  noGrowth: "Growth-rate data is waiting for the next published recompute.",
  noNewcomers: "Newcomer data is waiting for the next published recompute.",
  noWeeklyGrowth: "Weekly growth-rate archives are not published for this period.",
  noWeeklyNewcomers: "Weekly newcomer archives are not published for this period.",
};

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
  const periods = currentUtcPeriods();
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > periods.year) notFound();

  const [rank, growth, newc, heat, lookup] = await Promise.all([
    getRank("year", String(year), "repo", "flow"),
    getRank("year", String(year), "repo", "growth"),
    getRank("year", String(year), "repo", "new"),
    getHeatmap("year", String(year)),
    getReposLookup(),
  ]);
  if (!rank || !lookup) notFound();

  const pagePath = `/rankings/${year}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const title = fill(text.yearMetaTitle, { year });
  const rankRows = toGainedRows(rank.items.slice(0, RANKING_DETAIL_ROW_LIMIT), lookup);
  const most = rankRows.slice(0, PRIMARY_PANEL_LIMIT);
  const fastest = toGrowthRows(growth?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup);
  const newcomers = toNewcomerRows(newc?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup, locale);
  const movementCells = (heat?.cells ?? []).map(([period, total]) => {
    const month = Number(String(period).slice(5, 7));
    return { label: monthLabel(locale, month, "short"), gained: total, href: href(`/rankings/${year}/${month}`) };
  });
  const movementTotal = movementCells.reduce((sum, cell) => sum + cell.gained, 0);
  const asOf = resolveDataAsOfLabel(rank.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at, { locale });
  const dateModified = resolveDataAsOfValue(rank.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at);
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
  const previous = year > FIRST_YEAR ? { href: href(`/rankings/${year - 1}`), label: String(year - 1), eyebrow: t.common.previous } : null;
  const next = year < periods.year ? { href: href(`/rankings/${year + 1}`), label: String(year + 1), eyebrow: t.common.next } : null;

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
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "nav.rankings", href: "/rankings" }, { label: String(year) }]} />

        <PageHero
          className="mt-5"
          eyebrow={`${t.year.label} - ${DETAIL_UI.permanentArchive}`}
          title={year}
          lede={fill(DETAIL_UI.yearHero, { year })}
          actions={<HeroActions backHref={href("/rankings")} backLabel={t.nav.rankings} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: DETAIL_UI.starsAdded, value: movementCells.length > 0 ? `+${fmtStars(movementTotal)}` : DETAIL_UI.noMovement },
                { label: DETAIL_UI.visibleRows, value: `${formatInteger(locale, rankRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />

        <AnswerBlock capsule={capsule} rows={rankRows} locale={locale} labels={answerCapsuleLabels(locale, t)} emptyMessage={DETAIL_UI.noRankingRows} />

        <MovementSection title={DETAIL_UI.monthlyMovement} cells={movementCells} emptyMessage={DETAIL_UI.noMovement} labels={{ starsAdded: t.a11y.starsAdded }} />

        <RankingMetricGrid
          locale={locale}
          tableLabels={tableLabels}
          mostRows={most}
          fastestRows={fastest}
          newcomerRows={newcomers}
          mostTitle={DETAIL_UI.mostStarsAdded}
          fastestTitle={DETAIL_UI.fastestGrowth}
          newcomersTitle={DETAIL_UI.newcomers}
          gainedCaption={fill(text.gainedCaption, { label: String(year) })}
          growthCaption={fill(text.growthCaption, { label: String(year) })}
          newcomerCaption={fill(text.crossedCaption, { label: String(year) })}
          emptyRanking={DETAIL_UI.noRankingRows}
          emptyGrowth={DETAIL_UI.noGrowth}
          emptyNewcomers={DETAIL_UI.noNewcomers}
        />

        <CompleteRankingSection
          rows={rankRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: String(year) })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={DETAIL_UI.noRankingRows}
        />

        <PeriodNavigation title={DETAIL_UI.periodNavigation} previous={previous} next={next} />
        <RelatedPages
          title={DETAIL_UI.relatedTitle}
          description={DETAIL_UI.relatedDescription}
          items={[
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
          ]}
        />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
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

  const pageLabel = monthYearLabel(locale, year, month);
  const title = fill(text.periodMetaTitle, { label: pageLabel });
  const pagePath = `/rankings/${year}/${month}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const flowRows = toGainedRows(flow.items.slice(0, RANKING_DETAIL_ROW_LIMIT), lookup);
  const most = flowRows.slice(0, PRIMARY_PANEL_LIMIT);
  const fastest = toGrowthRows(growth?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup);
  const newcomers = toNewcomerRows(newc?.items.slice(0, SECONDARY_PANEL_LIMIT) ?? [], lookup, locale);
  const movementCells = (heat?.cells ?? []).map(([date, total]) => ({ label: String(Number(String(date).slice(8, 10))), gained: total }));
  const movementTotal = movementCells.reduce((sum, cell) => sum + cell.gained, 0);
  const asOf = resolveDataAsOfLabel(flow.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at, { locale });
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: flowRows, metric: "gained" }) : null;
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: flowRows, metric: "gained" });
  const narrative = buildNarrative({
    locale,
    label: pageLabel,
    topGainers: most.slice(0, 3).map((r) => ({ full_name: `${r.owner}/${r.name}`, gained: r.gained ?? 0 })),
    fastest: fastest.slice(0, 1).map((r) => ({ full_name: `${r.owner}/${r.name}`, rate: Math.round(r.rate ?? 0) })),
    newcomerCount: newc?.items.length ?? 0,
    newcomers: newcomers.slice(0, 2).map((r) => `${r.owner}/${r.name}`),
  });
  const tableLabels = repositoryTableLabels(t);
  const dateModified = resolveDataAsOfValue(flow.meta.generated_at, heat?.meta.generated_at, growth?.meta.generated_at, newc?.meta.generated_at);
  const dataset = datasetLd({
    name: fill(text.rankingDatasetName, { label: pageLabel }),
    path: routePath,
    locale: language,
    description: fill(text.rankingDatasetDescription, { label: pageLabel }),
    dateModified,
  });
  const monthNav = monthNavigation(locale, t, year, month, href);

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
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
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

        <PageHero
          className="mt-5"
          eyebrow={`${t.month.label} - ${DETAIL_UI.permanentArchive}`}
          title={pageLabel}
          lede={fill(DETAIL_UI.monthHero, { label: pageLabel })}
          actions={<HeroActions backHref={href(`/rankings/${year}`)} backLabel={String(year)} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: DETAIL_UI.starsAdded, value: movementCells.length > 0 ? `+${fmtStars(movementTotal)}` : DETAIL_UI.noMovement },
                { label: DETAIL_UI.visibleRows, value: `${formatInteger(locale, flowRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />

        <AnswerBlock capsule={capsule} rows={flowRows} locale={locale} labels={answerCapsuleLabels(locale, t)} emptyMessage={DETAIL_UI.noRankingRows} />

        {narrative && (
          <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)]">
            <p className="mb-3 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{pageLabel}</p>
            <Narrative text={narrative} locale={locale} />
          </section>
        )}

        <MovementSection title={DETAIL_UI.dailyMovement} cells={movementCells} emptyMessage={DETAIL_UI.noMovement} square columns={Math.min(16, Math.max(1, movementCells.length))} labels={{ starsAdded: t.a11y.starsAdded }} />

        <RankingMetricGrid
          locale={locale}
          tableLabels={tableLabels}
          mostRows={most}
          fastestRows={fastest}
          newcomerRows={newcomers}
          mostTitle={t.month.most}
          fastestTitle={t.month.fastest}
          newcomersTitle={t.month.newcomers}
          gainedCaption={fill(text.gainedCaption, { label: pageLabel })}
          growthCaption={fill(text.growthCaption, { label: pageLabel })}
          newcomerCaption={fill(text.crossedCaption, { label: pageLabel })}
          emptyRanking={DETAIL_UI.noRankingRows}
          emptyGrowth={DETAIL_UI.noGrowth}
          emptyNewcomers={DETAIL_UI.noNewcomers}
        />

        <CompleteRankingSection
          rows={flowRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: pageLabel })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={DETAIL_UI.noRankingRows}
        />

        <PeriodNavigation title={DETAIL_UI.periodNavigation} previous={monthNav.previous} next={monthNav.next} />
        <RelatedPages
          title={DETAIL_UI.relatedTitle}
          description={DETAIL_UI.relatedDescription}
          items={[
            relatedItem(href(`/rankings/${year}`), String(year)),
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
          ]}
        />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

async function WeekRankings({ locale, t, year, week }: { locale: Locale; t: Dict; year: number; week: number }) {
  if (week < 1 || week > 53) notFound();
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const period = isoWeekLabel(year, week);
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();

  const pagePath = `/rankings/${year}/W${String(week).padStart(2, "0")}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const rankRows = toGainedRows(flow.items.slice(0, RANKING_DETAIL_ROW_LIMIT), lookup);
  const most = rankRows.slice(0, PRIMARY_PANEL_LIMIT);
  const title = fill(text.periodMetaTitle, { label: period });
  const asOf = resolveDataAsOfLabel(flow.meta.generated_at, { locale });
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: rankRows, metric: "gained" }) : null;
  const snippet = buildWeeklyMoversSnippet({ locale, period, asOf, rows: rankRows, path: routePath });
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: rankRows, metric: "gained" });
  const tableLabels = repositoryTableLabels(t);
  const dateModified = resolveDataAsOfValue(flow.meta.generated_at);
  const dataset = datasetLd({
    name: fill(text.rankingDatasetName, { label: period }),
    path: routePath,
    locale: language,
    description: fill(text.rankingDatasetDescription, { label: period }),
    dateModified,
  });
  const weekNav = weekNavigation(t, year, week, href);

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
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
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
        <PageHero
          className="mt-5"
          eyebrow={`${t.week.label} - ${DETAIL_UI.permanentArchive}`}
          title={period}
          lede={fill(DETAIL_UI.weekHero, { label: period })}
          actions={<HeroActions backHref={href(`/rankings/${year}`)} backLabel={String(year)} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: t.week.label, value: period },
                { label: DETAIL_UI.visibleRows, value: `${formatInteger(locale, rankRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />
        <AnswerBlock capsule={capsule} rows={rankRows} locale={locale} labels={answerCapsuleLabels(locale, t)} emptyMessage={DETAIL_UI.noRankingRows} />
        {snippet && <ShareableSnippet snippet={snippet} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={shareableSnippetLabels(t)} />}

        <RankingMetricGrid
          locale={locale}
          tableLabels={tableLabels}
          mostRows={most}
          fastestRows={[]}
          newcomerRows={[]}
          mostTitle={DETAIL_UI.mostStarsAdded}
          fastestTitle={DETAIL_UI.fastestGrowth}
          newcomersTitle={DETAIL_UI.newcomers}
          gainedCaption={fill(text.gainedCaption, { label: period })}
          growthCaption={fill(text.growthCaption, { label: period })}
          newcomerCaption={fill(text.crossedCaption, { label: period })}
          emptyRanking={DETAIL_UI.noRankingRows}
          emptyGrowth={DETAIL_UI.noWeeklyGrowth}
          emptyNewcomers={DETAIL_UI.noWeeklyNewcomers}
        />

        <CompleteRankingSection
          rows={rankRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: period })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={DETAIL_UI.noRankingRows}
        />
        <PeriodNavigation title={DETAIL_UI.periodNavigation} previous={weekNav.previous} next={weekNav.next} />
        <RelatedPages
          title={DETAIL_UI.relatedTitle}
          description={DETAIL_UI.relatedDescription}
          items={[
            relatedItem(href(`/rankings/${year}`), String(year)),
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
          ]}
        />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function HeroActions({
  backHref,
  backLabel,
  completeLabel,
  shareText,
  shareLabels,
}: {
  backHref: string;
  backLabel: string;
  completeLabel: string;
  shareText: string;
  shareLabels: { label: string; copied: string; onX: string; opensNewTab: string };
}) {
  return (
    <>
      <Link href={backHref} className="text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline">
        {backLabel}
      </Link>
      <Link href="#complete-ranking" className="text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline">
        {completeLabel}
      </Link>
      <ShareButton text={shareText} labels={shareLabels} />
    </>
  );
}

function PeriodStats({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="grid gap-3 rounded-2xl border border-outline-variant bg-surface-container px-4 py-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{item.label}</dt>
          <dd className="mt-1 break-words font-mono text-[0.95rem] font-extrabold text-on-surface">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerBlock({
  capsule,
  rows,
  locale,
  labels,
  emptyMessage,
}: {
  capsule: Parameters<typeof AnswerCapsule>[0]["capsule"] | null;
  rows: Row[];
  locale: Locale;
  labels: Parameters<typeof AnswerCapsule>[0]["labels"];
  emptyMessage: string;
}) {
  if (!capsule) return null;
  return (
    <div className="mt-[clamp(1.75rem,4vw,3rem)]">
      <AnswerCapsule capsule={capsule} labels={labels} />
      <RankingLeaderLinks rows={rows.slice(0, 3)} locale={locale} emptyMessage={emptyMessage} />
    </div>
  );
}

function RankingLeaderLinks({ rows, locale, emptyMessage }: { rows: Row[]; locale: Locale; emptyMessage: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} className="mt-3" />;
  return (
    <nav aria-label={DETAIL_UI.topRepositoryLinks} className="mt-3 grid gap-2 md:grid-cols-3">
      {rows.map((row, index) => (
        <Link
          key={`${row.owner}/${row.name}`}
          href={localizedPath(locale, `/${row.owner}/${row.name}`)}
          className="min-w-0 rounded-2xl bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high"
        >
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-on-surface-variant">#{index + 1}</span>
          <span className="mt-1 block truncate font-mono text-[0.92rem] font-extrabold text-on-surface">
            {row.owner}/{row.name}
          </span>
          <span className="mt-1 block truncate font-mono text-[0.76rem] text-on-surface-variant">
            {row.gained == null ? `${fmtStars(row.total)}★` : `+${fmtStars(row.gained)}★`}
          </span>
        </Link>
      ))}
    </nav>
  );
}

function MovementSection({
  title,
  cells,
  emptyMessage,
  labels,
  square = false,
  columns,
}: {
  title: string;
  cells: HeatmapCell[];
  emptyMessage: string;
  labels: { starsAdded: string };
  square?: boolean;
  columns?: number;
}) {
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 text-[1.25rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      {cells.length > 0 ? <Heatmap cells={cells} max={Math.max(1, ...cells.map((cell) => cell.gained))} columns={columns ?? cells.length} square={square} labels={labels} /> : <EmptyState message={emptyMessage} />}
    </section>
  );
}

function RankingMetricGrid({
  locale,
  tableLabels,
  mostRows,
  fastestRows,
  newcomerRows,
  mostTitle,
  fastestTitle,
  newcomersTitle,
  gainedCaption,
  growthCaption,
  newcomerCaption,
  emptyRanking,
  emptyGrowth,
  emptyNewcomers,
}: {
  locale: Locale;
  tableLabels: ReturnType<typeof repositoryTableLabels>;
  mostRows: Row[];
  fastestRows: Row[];
  newcomerRows: NewcomerRow[];
  mostTitle: string;
  fastestTitle: string;
  newcomersTitle: string;
  gainedCaption: string;
  growthCaption: string;
  newcomerCaption: string;
  emptyRanking: string;
  emptyGrowth: string;
  emptyNewcomers: string;
}) {
  return (
    <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
      <RankingTablePanel title={mostTitle} rows={mostRows} variant="gained" locale={locale} tableCaption={gainedCaption} labels={tableLabels} emptyMessage={emptyRanking} />
      <RankingTablePanel title={fastestTitle} rows={fastestRows} variant="rate" locale={locale} tableCaption={growthCaption} labels={tableLabels} emptyMessage={emptyGrowth} />
      <NewcomerPanel title={newcomersTitle} rows={newcomerRows} locale={locale} caption={newcomerCaption} labels={tableLabels} emptyMessage={emptyNewcomers} />
    </div>
  );
}

function RankingTablePanel({
  title,
  rows,
  variant,
  locale,
  tableCaption,
  labels,
  emptyMessage,
}: {
  title: string;
  rows: Row[];
  variant: "gained" | "rate";
  locale: Locale;
  tableCaption: string;
  labels: ReturnType<typeof repositoryTableLabels>;
  emptyMessage: string;
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      {rows.length > 0 ? <RankingList rows={rows} variant={variant} locale={locale} tableCaption={tableCaption} labels={labels} /> : <EmptyState message={emptyMessage} />}
    </section>
  );
}

function NewcomerPanel({
  title,
  rows,
  locale,
  caption,
  labels,
  emptyMessage,
}: {
  title: string;
  rows: NewcomerRow[];
  locale: Locale;
  caption: string;
  labels: ReturnType<typeof repositoryTableLabels>;
  emptyMessage: string;
}) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      {rows.length > 0 ? (
        <div className="mt-[clamp(1rem,2vw,1.5rem)] overflow-x-auto pb-2">
          <table className="w-full min-w-[24rem] border-separate border-spacing-y-2 text-left">
            <caption className="mb-2 text-left font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{caption}</caption>
            <thead>
              <tr>
                <th scope="col" className="px-2.5 pb-1 font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant sm:px-3">
                  {labels.repository}
                </th>
                <th scope="col" className="px-2.5 pb-1 text-right font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant sm:px-3">
                  {labels.tenKCrossingDay}
                </th>
                <th scope="col" className="px-2.5 pb-1 text-right font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant sm:px-3">
                  {labels.totalStars}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.owner}/${row.name}`} className="group animate-rise">
                  <th scope="row" className="rounded-l-2xl bg-surface-container px-2.5 py-2.5 align-middle text-[0.86rem] text-on-surface transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3">
                    <Link href={localizedPath(locale, `/${row.owner}/${row.name}`)} className="font-mono font-semibold text-on-surface hover:underline hover:underline-offset-2">
                      {row.owner}/{row.name}
                    </Link>
                  </th>
                  <td className="bg-surface-container px-2.5 py-2.5 text-right align-middle font-mono text-[0.75rem] text-on-surface-variant transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3">
                    {row.crossedDate ?? ""}
                  </td>
                  <td className="rounded-r-2xl bg-surface-container px-2.5 py-2.5 text-right align-middle font-mono text-[0.86rem] font-extrabold tabular-nums text-on-surface transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3">
                    {fmtStars(row.total)}★
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </section>
  );
}

function CompleteRankingSection({
  rows,
  locale,
  tableCaption,
  labels,
  title,
  emptyMessage,
}: {
  rows: Row[];
  locale: Locale;
  tableCaption: string;
  labels: ReturnType<typeof repositoryTableLabels>;
  title: string;
  emptyMessage: string;
}) {
  return (
    <section id="complete-ranking" className="mt-[clamp(2.5rem,5vw,3.5rem)] min-w-0 scroll-mt-24">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      {rows.length > 0 ? <RankingList rows={rows} variant="gained" locale={locale} tableCaption={tableCaption} labels={labels} /> : <EmptyState message={emptyMessage} />}
    </section>
  );
}

function PeriodNavigation({ title, previous, next }: { title: string; previous: PeriodNavLink | null; next: PeriodNavLink | null }) {
  if (!previous && !next) return null;
  return (
    <nav aria-label={title} className="mt-[clamp(2.5rem,5vw,3.5rem)]">
      <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {previous && <PeriodNavigationCard link={previous} />}
        {next && <PeriodNavigationCard link={next} />}
      </div>
    </nav>
  );
}

function PeriodNavigationCard({ link }: { link: PeriodNavLink }) {
  return (
    <Link href={link.href} className="group flex min-h-16 items-center justify-between gap-3 rounded-lg bg-surface-container px-4 py-3 text-on-surface transition-colors hover:bg-surface-container-high">
      <span className="min-w-0">
        <span className="block font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{link.eyebrow}</span>
        <span className="mt-1 block truncate text-[1rem] font-extrabold group-hover:underline group-hover:underline-offset-2">{link.label}</span>
      </span>
      <span aria-hidden className="shrink-0 font-mono text-[1rem] text-on-surface-variant transition-colors group-hover:text-on-surface">
        &rarr;
      </span>
    </Link>
  );
}

function EmptyState({ message, className = "" }: { message: string; className?: string }) {
  return <p className={`rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>{message}</p>;
}

function toGainedRows(items: Parameters<typeof joinRepoRank>[0], lookup: Parameters<typeof joinRepoRank>[1]): Row[] {
  return joinRepoRank(items, lookup).map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    gained: r.value,
    total: r.current_stars,
  }));
}

function toGrowthRows(items: Parameters<typeof joinRepoRank>[0], lookup: Parameters<typeof joinRepoRank>[1]): Row[] {
  return joinRepoRank(items, lookup).map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    total: r.current_stars,
    rate: typeof r.rate === "number" ? r.rate : undefined,
  }));
}

function toNewcomerRows(items: Parameters<typeof joinRepoRank>[0], lookup: Parameters<typeof joinRepoRank>[1], locale: Locale): NewcomerRow[] {
  return joinRepoRank(items, lookup).map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    total: r.current_stars,
    crossedDate: r.date ? dateLabel(locale, r.date) : undefined,
  }));
}

function monthNavigation(locale: Locale, t: Dict, year: number, month: number, href: (path: string) => string): { previous: PeriodNavLink | null; next: PeriodNavLink | null } {
  const current = currentUtcPeriods();
  const previousMonth = shiftMonth(year, month, -1);
  const nextMonth = shiftMonth(year, month, 1);
  return {
    previous:
      previousMonth.year >= FIRST_YEAR
        ? {
            href: href(`/rankings/${previousMonth.year}/${previousMonth.month}`),
            label: monthYearLabel(locale, previousMonth.year, previousMonth.month),
            eyebrow: t.common.previous,
          }
        : null,
    next:
      nextMonth.year < current.year || (nextMonth.year === current.year && nextMonth.month <= current.month)
        ? {
            href: href(`/rankings/${nextMonth.year}/${nextMonth.month}`),
            label: monthYearLabel(locale, nextMonth.year, nextMonth.month),
            eyebrow: t.common.next,
          }
        : null,
  };
}

function weekNavigation(t: Dict, year: number, week: number, href: (path: string) => string): { previous: PeriodNavLink | null; next: PeriodNavLink | null } {
  const current = currentUtcPeriods().week;
  const previousWeek = shiftIsoWeek(year, week, -1);
  const nextWeek = shiftIsoWeek(year, week, 1);
  return {
    previous:
      previousWeek.year >= FIRST_YEAR
        ? {
            href: href(`/rankings/${previousWeek.year}/W${String(previousWeek.week).padStart(2, "0")}`),
            label: isoWeekLabel(previousWeek.year, previousWeek.week),
            eyebrow: t.common.previous,
          }
        : null,
    next:
      compareIsoWeeks(nextWeek, current) <= 0
        ? {
            href: href(`/rankings/${nextWeek.year}/W${String(nextWeek.week).padStart(2, "0")}`),
            label: isoWeekLabel(nextWeek.year, nextWeek.week),
            eyebrow: t.common.next,
          }
        : null,
  };
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function shiftIsoWeek(year: number, week: number, delta: number): { year: number; week: number } {
  const date = isoWeekStartDate(year, week);
  date.setUTCDate(date.getUTCDate() + delta * 7);
  return isoWeek(date);
}

function compareIsoWeeks(a: { year: number; week: number }, b: { year: number; week: number }): number {
  return isoWeekStartDate(a.year, a.week).getTime() - isoWeekStartDate(b.year, b.week).getTime();
}

function isoWeekStartDate(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  jan4.setUTCDate(jan4.getUTCDate() + 1 - day + (week - 1) * 7);
  return jan4;
}

function isoWeekLabel(year: number, week: number): string {
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function relatedItem(href: string, label: string) {
  return { href: href as `/${string}`, label };
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

function dateLabel(locale: Locale, value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(toBcp47Locale(locale), { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(Date.UTC(year, month - 1, day));
}
