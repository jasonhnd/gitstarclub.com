import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { Narrative } from "@/app/_explore/Narrative";
import { PageHero } from "@/app/_explore/PageHero";
import { RelatedPages } from "@/app/_explore/RelatedPages";
import { ShareableSnippet } from "@/app/_explore/ShareableSnippet";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { buildNarrative } from "@/lib/narrative";
import { FIRST_YEAR } from "@/lib/periods";
import { fmtStars, formatInteger, monthLabel, monthYearLabel } from "@/lib/format";
import { RankingCategoryExits } from "./ranking-category-exits";
import { getRank } from "@/lib/data";
import { HeroActions, PeriodStats, AnswerBlock, MovementSection, RankingMetricGrid, CompleteRankingSection, PeriodNavigation, type PeriodNavLink } from "./ranking-ui";
import { loadRankingDetailData, rankingDetailStructuredData, RANKING_FEATURED_LIMIT } from "./ranking-page-data";
import { resolveAdjacentRankPeriod, resolveAdjacentRankYear, resolveAvailableRankPeriods } from "@/lib/data/rank-periods";
import { pageMeta } from "@/lib/seo";
import { buildWeeklyMoversSnippet } from "@/lib/shareable-snippets";
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

  const data = await loadRankingDetailData("year", String(year), locale);
  if (!data) notFound();
  const { heat, rows: rankRows, most, categoryLinks, fastest, newcomers, asOf, dateModified } = data;

  const pagePath = `/rankings/${year}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const title = fill(text.yearMetaTitle, { year });
  const movementCandidates = (heat?.cells ?? []).map(([period, total]) => {
    const month = Number(String(period).slice(5, 7));
    return { month, period: `${year}-${String(month).padStart(2, "0")}`, total };
  });
  const movementRankChecks = await Promise.all(movementCandidates.map((cell) => getRank("month", cell.period, "repo", "flow")));
  const movementCells = movementCandidates.flatMap((cell, index) =>
    movementRankChecks[index] ? [{ label: monthLabel(locale, cell.month, "short"), gained: cell.total, href: href(`/rankings/${year}/${cell.month}`) }] : [],
  );
  const movementTotal = movementCells.reduce((sum, cell) => sum + cell.gained, 0);
  const tableLabels = repositoryTableLabels(t);
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: rankRows, metric: "gained" }) : null;
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: rankRows, metric: "gained" });
  const [previousYear, nextYear] = await Promise.all([resolveAdjacentRankYear(year, -1), resolveAdjacentRankYear(year, 1)]);
  const previous = previousYear ? { href: href(previousYear.href), label: previousYear.label, eyebrow: t.common.previous } : null;
  const next = nextYear ? { href: href(nextYear.href), label: nextYear.label, eyebrow: t.common.next } : null;

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      {rankingDetailStructuredData({ locale, path: routePath, label: String(year), rows: rankRows, dateModified }).map((data, index) => <JsonLd key={index} data={data} />)}
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
        <RankingCategoryExits locale={locale} links={categoryLinks} t={t} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
          items={[
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
            ...categoryLinks.slice(0, RANKING_FEATURED_LIMIT).map((category) => relatedItem(href(category.href), category.label)),
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
  const data = await loadRankingDetailData("month", period, locale);
  if (!data) notFound();
  const { newc, heat, rows: flowRows, most, categoryLinks, fastest, newcomers, asOf, dateModified } = data;

  const pageLabel = monthYearLabel(locale, year, month);
  const title = fill(text.periodMetaTitle, { label: pageLabel });
  const pagePath = `/rankings/${year}/${month}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const movementCells = (heat?.cells ?? []).map(([date, total]) => ({ label: String(Number(String(date).slice(8, 10))), gained: total }));
  const movementTotal = movementCells.reduce((sum, cell) => sum + cell.gained, 0);
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: flowRows, metric: "gained" }) : null;
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: flowRows, metric: "gained" });
  const narrative = buildNarrative({
    locale,
    label: pageLabel,
    topGainers: most.slice(0, RANKING_FEATURED_LIMIT).map((r) => ({ full_name: `${r.owner}/${r.name}`, gained: r.gained ?? 0 })),
    fastest: fastest.slice(0, 1).map((r) => ({ full_name: `${r.owner}/${r.name}`, rate: Math.round(r.rate ?? 0) })),
    newcomerCount: newc?.items.length ?? 0,
    newcomers: newcomers.slice(0, 2).map((r) => `${r.owner}/${r.name}`),
  });
  const tableLabels = repositoryTableLabels(t);
  const monthNav = await monthNavigation(locale, t, year, month, href);

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      {rankingDetailStructuredData({ locale, path: routePath, label: pageLabel, rows: flowRows, dateModified }).map((data, index) => <JsonLd key={index} data={data} />)}
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
        <RankingCategoryExits locale={locale} links={categoryLinks} t={t} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
          items={[
            relatedItem(href(`/rankings/${year}`), String(year)),
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
            ...categoryLinks.slice(0, RANKING_FEATURED_LIMIT).map((category) => relatedItem(href(category.href), category.label)),
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
  const data = await loadRankingDetailData("week", period, locale);
  if (!data) notFound();
  const { rows: rankRows, most, categoryLinks, asOf, dateModified } = data;

  const pagePath = `/rankings/${year}/W${String(week).padStart(2, "0")}`;
  const routePath = localizedPath(locale, pagePath);
  const href = (path: string) => localizedPath(locale, path);
  const title = fill(text.periodMetaTitle, { label: period });
  const capsule = asOf ? buildLocalizedRankingCapsule({ locale, title, asOf, rows: rankRows, metric: "gained" }) : null;
  const snippet = buildWeeklyMoversSnippet({ locale, period, asOf, rows: rankRows, path: routePath });
  const faqItems = buildLocalizedRankingFaqs({ locale, title, asOf, rows: rankRows, metric: "gained" });
  const tableLabels = repositoryTableLabels(t);
  const weekNav = await weekNavigation(t, year, week, href);

  return (
    <>
      <Chrome locale={locale} canonicalPath={pagePath} dictionary={t} />
      {rankingDetailStructuredData({ locale, path: routePath, label: period, rows: rankRows, dateModified }).map((data, index) => <JsonLd key={index} data={data} />)}
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
        <RankingCategoryExits locale={locale} links={categoryLinks} t={t} />
        <RelatedPages
          title={t.rankings.relatedTitle}
          description={t.rankings.relatedDescription}
          items={[
            relatedItem(href(`/rankings/${year}`), String(year)),
            relatedItem(href("/rankings"), t.rankings.title),
            relatedItem(href("/pulse"), t.nav.pulse),
            ...categoryLinks.slice(0, RANKING_FEATURED_LIMIT).map((category) => relatedItem(href(category.href), category.label)),
          ]}
        />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
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
