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
import { Star } from "@/app/_explore/Star";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { buildNarrative } from "@/lib/narrative";
import { FIRST_YEAR } from "@/lib/periods";
import { dateLabel, fmtStars, formatInteger, monthLabel, monthYearLabel } from "@/lib/format";
import { getHeatmap, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { resolveAdjacentRankPeriod, resolveAdjacentRankYear, resolveAvailableRankPeriods } from "@/lib/data/rank-periods";
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

export async function generateRankingYearStaticParams(): Promise<YearParam[]> {
  const periods = await resolveAvailableRankPeriods();
  return periods.yearLink.kind === "year" ? [{ year: String(periods.yearLink.year) }] : [];
}

export async function generateLocalizedRankingYearStaticParams(): Promise<Array<YearParam & { locale: Locale }>> {
  const params = await generateRankingYearStaticParams();
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => params.map((param) => ({ locale, ...param })));
}

export async function generateRankingPeriodStaticParams(): Promise<PeriodParam[]> {
  const periods = await resolveAvailableRankPeriods();
  const params: PeriodParam[] = [];
  if (periods.month.kind === "month") params.push({ year: String(periods.month.year), period: String(periods.month.month) });
  if (periods.week.kind === "week") params.push({ year: String(periods.week.year), period: `W${String(periods.week.week).padStart(2, "0")}` });
  return params;
}

export async function generateLocalizedRankingPeriodStaticParams(): Promise<Array<PeriodParam & { locale: Locale }>> {
  const params = await generateRankingPeriodStaticParams();
  return generateCoreLocaleStaticParams().flatMap(({ locale }) => params.map((param) => ({ locale, ...param })));
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

export async function RankingsYearPageView({ locale, year: yearValue, now = new Date() }: { locale: Locale; year: string; now?: Date }) {
  const t = await getDictionary(locale);
  const text = detailText(locale);
  const language = toBcp47Locale(locale);
  const year = Number(yearValue);
  const availablePeriods = await resolveAvailableRankPeriods(now);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > availablePeriods.year) notFound();

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
  const movementCandidates = (heat?.cells ?? []).map(([period, total]) => {
    const month = Number(String(period).slice(5, 7));
    return { month, period: `${year}-${String(month).padStart(2, "0")}`, total };
  });
  const movementRankChecks = await Promise.all(movementCandidates.map((cell) => getRank("month", cell.period, "repo", "flow")));
  const movementCells = movementCandidates.flatMap((cell, index) =>
    movementRankChecks[index] ? [{ label: monthLabel(locale, cell.month, "short"), gained: cell.total, href: href(`/rankings/${year}/${cell.month}`) }] : [],
  );
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
  const [previousYear, nextYear] = await Promise.all([resolveAdjacentRankYear(year, -1), resolveAdjacentRankYear(year, 1)]);
  const previous = previousYear ? { href: href(previousYear.href), label: previousYear.label, eyebrow: t.common.previous } : null;
  const next = nextYear ? { href: href(nextYear.href), label: nextYear.label, eyebrow: t.common.next } : null;

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
          rankRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "nav.rankings", href: "/rankings" }, { label: String(year) }]} />

        <PageHero
          className="mt-5"
          eyebrow={`${t.year.label} - ${t.rankings.permanentArchive}`}
          title={year}
          lede={fill(t.rankings.yearHero, { year })}
          actions={<HeroActions backHref={href("/rankings")} backLabel={t.nav.rankings} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: t.tables.starsGained, value: movementCells.length > 0 ? `+${fmtStars(movementTotal, locale)}` : t.rankings.noMovement },
                { label: t.rankings.visibleRows, value: `${formatInteger(locale, rankRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />

        <AnswerBlock capsule={capsule} rows={rankRows} locale={locale} labels={answerCapsuleLabels(locale, t)} leaderLinksLabel={t.a11y.topRepositoryLinks} emptyMessage={t.categories.rankingPending} />

        <MovementSection title={t.rankings.monthlyMovement} cells={movementCells} emptyMessage={t.rankings.noMovement} labels={{ starsAdded: t.a11y.starsAdded }} locale={locale} />

        <RankingMetricGrid
          locale={locale}
          tableLabels={tableLabels}
          mostRows={most}
          fastestRows={fastest}
          newcomerRows={newcomers}
          mostTitle={t.month.most}
          fastestTitle={t.month.fastest}
          newcomersTitle={t.month.newcomers}
          gainedCaption={fill(text.gainedCaption, { label: String(year) })}
          growthCaption={fill(text.growthCaption, { label: String(year) })}
          newcomerCaption={fill(text.crossedCaption, { label: String(year) })}
          emptyRanking={t.categories.rankingPending}
          emptyGrowth={t.rankings.noGrowth}
          emptyNewcomers={t.rankings.noNewcomers}
        />

        <CompleteRankingSection
          rows={rankRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: String(year) })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={t.categories.rankingPending}
        />

        <PeriodNavigation title={t.rankings.periodNavigation} previous={previous} next={next} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
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
  const periods = await resolveAvailableRankPeriods();
  const maxYear = Math.max(
    periods.year,
    periods.month.kind === "month" ? periods.month.year : FIRST_YEAR,
    periods.week.kind === "week" ? periods.week.year : FIRST_YEAR,
  );
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
  const monthNav = await monthNavigation(locale, t, year, month, href);

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
          flowRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) })),
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
          eyebrow={`${t.month.label} - ${t.rankings.permanentArchive}`}
          title={pageLabel}
          lede={fill(t.rankings.monthHero, { label: pageLabel })}
          actions={<HeroActions backHref={href(`/rankings/${year}`)} backLabel={String(year)} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: t.tables.starsGained, value: movementCells.length > 0 ? `+${fmtStars(movementTotal, locale)}` : t.rankings.noMovement },
                { label: t.rankings.visibleRows, value: `${formatInteger(locale, flowRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />

        <AnswerBlock capsule={capsule} rows={flowRows} locale={locale} labels={answerCapsuleLabels(locale, t)} leaderLinksLabel={t.a11y.topRepositoryLinks} emptyMessage={t.categories.rankingPending} />

        {narrative && (
          <section className="mt-[clamp(1.75rem,3.5vw,2.75rem)]">
            <p className="mb-3 font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{pageLabel}</p>
            <Narrative text={narrative} locale={locale} />
          </section>
        )}

        <MovementSection title={t.rankings.dailyMovement} cells={movementCells} emptyMessage={t.rankings.noMovement} square columns={Math.min(16, Math.max(1, movementCells.length))} labels={{ starsAdded: t.a11y.starsAdded }} locale={locale} />

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
          emptyRanking={t.categories.rankingPending}
          emptyGrowth={t.rankings.noGrowth}
          emptyNewcomers={t.rankings.noNewcomers}
        />

        <CompleteRankingSection
          rows={flowRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: pageLabel })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={t.categories.rankingPending}
        />

        <PeriodNavigation title={t.rankings.periodNavigation} previous={monthNav.previous} next={monthNav.next} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
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
  const weekNav = await weekNavigation(t, year, week, href);

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
          rankRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) })),
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
          eyebrow={`${t.week.label} - ${t.rankings.permanentArchive}`}
          title={period}
          lede={fill(t.rankings.weekHero, { label: period })}
          actions={<HeroActions backHref={href(`/rankings/${year}`)} backLabel={String(year)} shareText={title} shareLabels={shareButtonLabels(locale, t)} completeLabel={text.completeRanking} />}
          aside={
            <PeriodStats
              items={[
                { label: t.week.label, value: period },
                { label: t.rankings.visibleRows, value: `${formatInteger(locale, rankRows.length)} ${t.rankings.repos}` },
              ]}
            />
          }
        />
        <AnswerBlock capsule={capsule} rows={rankRows} locale={locale} labels={answerCapsuleLabels(locale, t)} leaderLinksLabel={t.a11y.topRepositoryLinks} emptyMessage={t.categories.rankingPending} />
        {snippet && <ShareableSnippet snippet={snippet} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={shareableSnippetLabels(t)} />}

        <RankingMetricGrid
          locale={locale}
          tableLabels={tableLabels}
          mostRows={most}
          fastestRows={[]}
          newcomerRows={[]}
          mostTitle={t.month.most}
          fastestTitle={t.month.fastest}
          newcomersTitle={t.month.newcomers}
          gainedCaption={fill(text.gainedCaption, { label: period })}
          growthCaption={fill(text.growthCaption, { label: period })}
          newcomerCaption={fill(text.crossedCaption, { label: period })}
          emptyRanking={t.categories.rankingPending}
          emptyGrowth={t.rankings.noWeeklyGrowth}
          emptyNewcomers={t.rankings.noWeeklyNewcomers}
        />

        <CompleteRankingSection
          rows={rankRows}
          locale={locale}
          tableCaption={fill(text.completeRepositoryRankingsCaption, { label: period })}
          labels={tableLabels}
          title={text.completeRanking}
          emptyMessage={t.categories.rankingPending}
        />
        <PeriodNavigation title={t.rankings.periodNavigation} previous={weekNav.previous} next={weekNav.next} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
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
  leaderLinksLabel,
  emptyMessage,
}: {
  capsule: Parameters<typeof AnswerCapsule>[0]["capsule"] | null;
  rows: Row[];
  locale: Locale;
  labels: Parameters<typeof AnswerCapsule>[0]["labels"];
  leaderLinksLabel: string;
  emptyMessage: string;
}) {
  if (!capsule) return null;
  return (
    <div className="mt-[clamp(1.75rem,4vw,3rem)]">
      <AnswerCapsule capsule={capsule} labels={labels} />
      <RankingLeaderLinks rows={rows.slice(0, 3)} locale={locale} ariaLabel={leaderLinksLabel} emptyMessage={emptyMessage} />
    </div>
  );
}

function RankingLeaderLinks({ rows, locale, ariaLabel, emptyMessage }: { rows: Row[]; locale: Locale; ariaLabel: string; emptyMessage: string }) {
  if (rows.length === 0) return <EmptyState message={emptyMessage} className="mt-3" />;
  return (
    <nav aria-label={ariaLabel} className="mt-3 grid gap-2 md:grid-cols-3">
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
            {row.gained == null ? (
              <>
                {fmtStars(row.total, locale)}
                <Star />
              </>
            ) : (
              <>
                +{fmtStars(row.gained, locale)}
                <Star />
              </>
            )}
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
  locale,
  square = false,
  columns,
}: {
  title: string;
  cells: HeatmapCell[];
  emptyMessage: string;
  labels: { starsAdded: string };
  locale: Locale;
  square?: boolean;
  columns?: number;
}) {
  return (
    <section className="mt-[clamp(2rem,4vw,3rem)]">
      <h2 className="mb-3 text-[1.25rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
      {cells.length > 0 ? <Heatmap cells={cells} max={Math.max(1, ...cells.map((cell) => cell.gained))} columns={columns ?? cells.length} square={square} labels={labels} locale={locale} /> : <EmptyState message={emptyMessage} />}
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
      {rows.length > 0 ? <RankingList rows={rows} variant={variant} locale={locale} tableCaption={tableCaption} labels={labels} compact /> : <EmptyState message={emptyMessage} />}
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
        <div className="mt-[clamp(1rem,2vw,1.5rem)]">
          <p className="mb-2 text-left font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{caption}</p>
          <ol className="space-y-2" aria-label={caption}>
            {rows.map((row, index) => (
              <li key={`${row.owner}/${row.name}`} className="group animate-rise rounded-2xl bg-surface-container px-3 py-3 transition-colors hover:bg-surface-container-high" style={{ animationDelay: `${0.04 * Math.min(index, 12)}s` }}>
                <div className="grid min-w-0 gap-2">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
                    <Link href={localizedPath(locale, `/${row.owner}/${row.name}`)} className="block min-w-0 truncate font-mono text-[0.86rem] font-semibold text-on-surface hover:underline hover:underline-offset-2">
                      {row.owner}/{row.name}
                    </Link>
                    <span className="shrink-0 whitespace-nowrap font-mono text-[0.86rem] font-extrabold tabular-nums">
                      {fmtStars(row.total, locale)}
                      <Star />
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-[0.72rem] tabular-nums text-on-surface-variant">
                      {labels.tenKCrossingDay}: {row.crossedDate ?? ""}
                    </span>
                    <span className="inline-flex max-w-full items-center rounded-full bg-surface-container-high px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">
                      <span className="break-all">{row.lang ?? labels.unknown}</span>
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
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

async function monthNavigation(locale: Locale, t: Dict, year: number, month: number, href: (path: string) => string): Promise<{ previous: PeriodNavLink | null; next: PeriodNavLink | null }> {
  const [previousMonth, nextMonth] = await Promise.all([
    resolveAdjacentRankPeriod("month", { year, month }, -1),
    resolveAdjacentRankPeriod("month", { year, month }, 1),
  ]);
  return {
    previous: previousMonth
      ? {
          href: href(previousMonth.href),
          label: monthYearLabel(locale, previousMonth.year, previousMonth.month),
          eyebrow: t.common.previous,
        }
      : null,
    next: nextMonth
      ? {
          href: href(nextMonth.href),
          label: monthYearLabel(locale, nextMonth.year, nextMonth.month),
          eyebrow: t.common.next,
        }
      : null,
  };
}

async function weekNavigation(t: Dict, year: number, week: number, href: (path: string) => string): Promise<{ previous: PeriodNavLink | null; next: PeriodNavLink | null }> {
  const [previousWeek, nextWeek] = await Promise.all([
    resolveAdjacentRankPeriod("week", { year, week }, -1),
    resolveAdjacentRankPeriod("week", { year, week }, 1),
  ]);
  return {
    previous: previousWeek
      ? {
          href: href(previousWeek.href),
          label: isoWeekLabel(previousWeek.year, previousWeek.week),
          eyebrow: t.common.previous,
        }
      : null,
    next: nextWeek
      ? {
          href: href(nextWeek.href),
          label: isoWeekLabel(nextWeek.year, nextWeek.week),
          eyebrow: t.common.next,
        }
      : null,
  };
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
