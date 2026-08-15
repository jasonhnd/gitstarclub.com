import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { PageHero } from "@/app/_explore/PageHero";
import { PeriodSwitcher, type PeriodSwitcherTarget } from "@/app/_explore/PeriodSwitcher";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getHotSnapshot, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { resolveAvailableRankPeriods, type AvailableRankPeriods } from "@/lib/data/rank-periods";
import { dateLabel, fmtStars } from "@/lib/format";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { webSiteLd, collectionLd, datasetLd, datasetRef, datasetTemporalCoverageFromYearSpine, siteOrganizationLd } from "@/lib/jsonld";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { currentUtcPeriods } from "@/lib/periods";
import {
  availablePeriodLabel,
  formatPulseListMeta,
  isFallbackMonthPeriod,
  isFallbackWeekPeriod,
  periodAsOfCandidate,
  type PulseListMetaCopy,
} from "@/lib/rank-period-labels";
import { pageMeta } from "@/lib/seo";
import { repositoryTableLabels } from "./routing";
import { buildLocalizedPulseCapsule, buildLocalizedPulseFaqs } from "./seo-copy";
import { answerCapsuleLabels } from "./detail-copy";

export async function generatePulseMetadata({
  locale,
  canonicalPath,
  absoluteTitle = false,
}: {
  locale: Locale;
  canonicalPath: "/" | "/pulse";
  absoluteTitle?: boolean;
}): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    absoluteTitle,
    title: absoluteTitle ? `${t.meta.homeTitle} · GitStarClub` : t.meta.pulseTitle,
    description: canonicalPath === "/" ? t.meta.homeDescription : t.meta.pulseDescription,
    path: canonicalPath,
    locale,
  });
}

type PulseViewProps = {
  locale: Locale;
  canonicalPath: "/" | "/pulse";
  includeWebsiteLd?: boolean;
};

export async function PulsePageView({ locale, canonicalPath, includeWebsiteLd = false }: PulseViewProps) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, canonicalPath);
  const href = (path: string) => localizedPath(locale, path);
  const now = new Date();
  const periods = currentUtcPeriods(now);
  const [snap, lookup, availablePeriods] = await Promise.all([
    getHotSnapshot(),
    getReposLookup(),
    resolveAvailableRankPeriods(now),
  ]);
  const [activeWeekRank, activeMonthRank] = await Promise.all([
    availablePeriods.week.kind === "week" ? getRank("week", availablePeriods.week.period, "repo", "flow") : Promise.resolve(null),
    availablePeriods.month.kind === "month" ? getRank("month", availablePeriods.month.period, "repo", "flow") : Promise.resolve(null),
  ]);

  const labelCopy = { fullHistory: t.rankings.fullHistory };
  const metaCopy = pulseListMetaCopy(t);
  const activeWeekLabel = availablePeriodLabel(locale, availablePeriods.week, labelCopy);
  const activeMonthLabel = availablePeriodLabel(locale, availablePeriods.month, labelCopy);
  const activeYearLabel = availablePeriodLabel(locale, availablePeriods.yearLink, labelCopy);
  const weekRows = lookup && activeWeekRank ? toRows(joinRepoRank(activeWeekRank.items.slice(0, 8), lookup)) : [];
  const monthRows = lookup && activeMonthRank ? toRows(joinRepoRank(activeMonthRank.items.slice(0, 8), lookup)) : [];
  const yearRows = snap && lookup ? toRows(joinRepoRank(snap.current_year.flow.slice(0, 8), lookup)) : [];
  const giants = snap && lookup ? toRows(joinRepoRank(snap.all_time.repo.slice(0, 6), lookup), "total") : [];
  const asOf = resolveDataAsOfLabel(snap?.generated_at, activeWeekRank?.meta.generated_at, activeMonthRank?.meta.generated_at, { locale });
  const dateModified = resolveDataAsOfValue(snap?.generated_at, activeWeekRank?.meta.generated_at, activeMonthRank?.meta.generated_at);
  const weekMeta = formatPulseListMeta({
    periodLabel: activeWeekLabel,
    isFallback: isFallbackWeekPeriod(availablePeriods.week, periods),
    asOf: periodAsOfCandidate(availablePeriods.week) ?? activeWeekRank?.meta.generated_at ?? snap?.generated_at,
    locale,
    copy: metaCopy,
  });
  const monthMeta = formatPulseListMeta({
    periodLabel: activeMonthLabel,
    isFallback: isFallbackMonthPeriod(availablePeriods.month, periods),
    asOf: periodAsOfCandidate(availablePeriods.month) ?? activeMonthRank?.meta.generated_at ?? snap?.generated_at,
    locale,
    copy: metaCopy,
  });
  const yearMeta = formatPulseListMeta({
    periodLabel: activeYearLabel,
    isFallback: availablePeriods.yearLink.kind !== "year" || availablePeriods.yearLink.year !== periods.year,
    asOf: periodAsOfCandidate(availablePeriods.yearLink) ?? snap?.freshness?.current_year ?? snap?.generated_at,
    locale,
    copy: metaCopy,
  });
  const allTimeMeta = formatPulseListMeta({
    periodLabel: t.rankings.fullHistory,
    asOf: snap?.freshness?.all_time ?? snap?.generated_at,
    locale,
    copy: metaCopy,
  });
  const todayIso = now.toISOString().slice(0, 10);
  const onThisDayMeta = formatPulseListMeta({
    periodLabel: dateLabel(locale, todayIso, "long"),
    asOf: snap?.freshness?.on_this_day ?? snap?.generated_at,
    locale,
    copy: metaCopy,
  });
  const temporalCoverage = datasetTemporalCoverageFromYearSpine(snap?.home.year_spine);
  const dataset = datasetLd({
    name: t.pulse.datasetName,
    path: routePath,
    locale: language,
    description: t.meta.pulseDescription,
    dateModified,
    temporalCoverage,
  });
  const capsule = asOf
    ? buildLocalizedPulseCapsule({ locale, asOf, weekRows, monthRows, activeWeek: activeWeekLabel, activeMonth: activeMonthLabel })
    : null;
  const faqItems = buildLocalizedPulseFaqs(locale, { asOf, weekRows, monthRows, activeWeek: activeWeekLabel, activeMonth: activeMonthLabel });
  const onThisDay = (snap?.home.on_this_day ?? []).flatMap((e) => {
    const m = lookup?.[String(e.id)];
    return m ? [{ ...e, full_name: m.full_name, owner: m.owner, name: m.name }] : [];
  });
  const repoLabels = repositoryTableLabels(t);
  const openRankingLabel = `${t.pulse.open} ${t.nav.rankings}`;

  return (
    <>
      <Chrome locale={locale} canonicalPath={canonicalPath} dictionary={t} />
      {includeWebsiteLd && <JsonLd data={siteOrganizationLd()} />}
      {includeWebsiteLd && <JsonLd data={webSiteLd(language, routePath, { dateModified, about: datasetRef(routePath) })} />}
      <JsonLd data={collectionLd(t.pulse.title, routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.25rem,3.5vw,2.75rem)] ${PAD_X}`}>
        {/* Human-first hierarchy (#285): identity → period → repo discovery, then methodology/GEO. */}
        <PageHero eyebrow={t.nav.pulse} title={t.pulse.title} lede={t.pulse.subtitle} />

        <div className="mt-[clamp(1rem,2.5vw,1.5rem)]">
          <PeriodSwitcher links={periodSwitcherLinks(availablePeriods, periods, href, locale, t)} activePeriod={availablePeriods.week.kind === "week" ? "week" : "all-time"} ariaLabel={t.a11y.rankingPeriod} />
        </div>

        <div className="mt-[clamp(1.25rem,3vw,2rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <PulsePanel
            title={t.week.top}
            href={href(availablePeriods.week.href)}
            meta={weekMeta}
            rows={weekRows}
            labels={repoLabels}
            openLabel={openRankingLabel}
            linkLabel={`${openRankingLabel}: ${activeWeekLabel}`}
            emptyMessage={t.categories.rankingPending}
            locale={locale}
          />
          <PulsePanel
            title={t.pulse.surging}
            href={href(availablePeriods.month.href)}
            meta={monthMeta}
            rows={monthRows}
            labels={repoLabels}
            openLabel={openRankingLabel}
            linkLabel={`${openRankingLabel}: ${activeMonthLabel}`}
            emptyMessage={t.categories.rankingPending}
            locale={locale}
          />
          <PulsePanel
            title={
              <>
                {t.year.top} {activeYearLabel}
              </>
            }
            href={href(availablePeriods.yearLink.href)}
            meta={yearMeta}
            rows={yearRows}
            labels={repoLabels}
            openLabel={openRankingLabel}
            linkLabel={`${openRankingLabel}: ${activeYearLabel}`}
            emptyMessage={t.categories.rankingPending}
            locale={locale}
          />
        </div>

        <PulseLeaderLinks
          links={[
            { label: t.week.label, href: href(availablePeriods.week.href), period: weekMeta, row: weekRows[0] },
            { label: t.month.label, href: href(availablePeriods.month.href), period: monthMeta, row: monthRows[0] },
            { label: t.year.label, href: href(availablePeriods.yearLink.href), period: yearMeta, row: yearRows[0] },
          ]}
          pendingLabel={t.categories.rankingPending}
          locale={locale}
          className="mt-[clamp(1.25rem,3vw,2rem)]"
        />

        <section className="mt-[clamp(2rem,4.5vw,3.25rem)] grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[1.35rem] font-extrabold tracking-tight text-on-surface">{t.rankings.title}</h2>
                  <span className="rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">{allTimeMeta}</span>
                </div>
                <p className="mt-1 text-[0.9rem] text-on-surface-variant">{t.rankings.subtitle}</p>
              </div>
              <Link href={href("/rankings")} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
                {t.rankings.title}
              </Link>
            </div>
            {giants.length > 0 ? (
              <div className="max-w-full overflow-x-auto">
                <RankingList rows={giants} variant="total" locale={locale} labels={repoLabels} />
              </div>
            ) : (
              <EmptyState message={t.categories.rankingPending} />
            )}
          </div>

          <aside className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.pulse.onThisDay}</h2>
              <span className="rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">{onThisDayMeta}</span>
            </div>
            {onThisDay.length > 0 ? (
              <ul className="flex flex-col divide-y divide-outline-variant/50">
                {onThisDay.slice(0, 8).map((e) => (
                  <li key={`${e.id}-${e.crossed}`}>
                    <Link href={href(`/${e.owner}/${e.name}`)} className="group block py-2.5 transition-colors hover:bg-on-surface/5">
                      <span className="block truncate font-mono text-[0.86rem] text-on-surface group-hover:underline group-hover:underline-offset-2">{e.full_name}</span>
                      <span className="font-mono text-[0.75rem] tabular-nums text-on-surface-variant">
                        {t.pulse.crossed} <span className="text-readable-gold font-semibold">{e.crossed}</span> · {dateLabel(locale, e.date)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message={t.categories.rankingPending} className="mt-0" />
            )}
          </aside>
        </section>

        {capsule && (
          <div className="mt-[clamp(2rem,4.5vw,3.25rem)]">
            <AnswerCapsule capsule={capsule} labels={answerCapsuleLabels(locale, t)} />
          </div>
        )}

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function toRows(items: ReturnType<typeof joinRepoRank>, mode: "gained" | "total" = "gained"): Row[] {
  return items.map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    gained: mode === "gained" ? r.value : undefined,
    total: r.current_stars,
  }));
}

function PulsePanel({
  title,
  href,
  meta,
  rows,
  labels,
  openLabel,
  linkLabel,
  emptyMessage,
  locale,
}: {
  title: ReactNode;
  href: string;
  meta?: string;
  rows: Row[];
  labels: ReturnType<typeof repositoryTableLabels>;
  openLabel: string;
  linkLabel: string;
  emptyMessage: string;
  locale: Locale;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {meta && <span className="rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">{meta}</span>}
          <Link href={href} aria-label={linkLabel} className="text-readable-gold font-mono text-[0.72rem] hover:underline">
            {openLabel}
          </Link>
        </div>
      </div>
      {rows.length > 0 ? (
        <RankingList rows={rows} variant="gained" labels={labels} locale={locale} compact />
      ) : (
        <EmptyState message={emptyMessage} />
      )}
    </section>
  );
}

function PulseLeaderLinks({
  links,
  pendingLabel,
  locale,
  className = "mt-3",
}: {
  links: Array<{ label: ReactNode; href: string; period: string; row?: Row }>;
  pendingLabel: string;
  locale: Locale;
  className?: string;
}) {
  return (
    <div className={`${className} grid gap-2 md:grid-cols-3`}>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="min-w-0 rounded-2xl bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high"
        >
          <span className="font-mono text-[0.7rem] uppercase tracking-wider text-on-surface-variant">{link.label}</span>
          <span className="mt-1 block truncate font-mono text-[0.92rem] font-extrabold text-on-surface">
            {link.row ? `${link.row.owner}/${link.row.name}` : pendingLabel}
          </span>
          <span className="mt-1 block truncate font-mono text-[0.76rem] text-on-surface-variant">
            {link.row?.gained == null ? link.period : `${link.period} · +${fmtStars(link.row.gained, locale)}`}
          </span>
        </Link>
      ))}
    </div>
  );
}

function EmptyState({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p className={`mt-[clamp(1rem,2vw,1.5rem)] rounded-2xl border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>
      {message}
    </p>
  );
}

function periodSwitcherLinks(
  periods: AvailableRankPeriods,
  calendar: ReturnType<typeof currentUtcPeriods>,
  href: (path: string) => string,
  locale: Locale,
  t: Dict,
): Record<"all-time" | "year" | "month" | "week", PeriodSwitcherTarget> {
  const labelCopy = { fullHistory: t.rankings.fullHistory };
  return {
    "all-time": { href: href(periods.allTime.href), label: t.rankings.allTime, value: t.rankings.fullHistory },
    year: { href: href(periods.yearLink.href), label: t.year.label, value: availablePeriodLabel(locale, periods.yearLink, labelCopy) },
    month: {
      href: href(periods.month.href),
      label: t.month.label,
      value: availablePeriodLabel(locale, periods.month, labelCopy),
      badge: isFallbackMonthPeriod(periods.month, calendar)
        ? fill(t.common.latestAvailable, { period: availablePeriodLabel(locale, periods.month, labelCopy) })
        : undefined,
    },
    week: {
      href: href(periods.week.href),
      label: t.week.label,
      value: availablePeriodLabel(locale, periods.week, labelCopy),
      badge: isFallbackWeekPeriod(periods.week, calendar)
        ? fill(t.common.latestAvailable, { period: availablePeriodLabel(locale, periods.week, labelCopy) })
        : undefined,
    },
  };
}

function pulseListMetaCopy(t: Dict): PulseListMetaCopy {
  return {
    fullHistory: t.rankings.fullHistory,
    latestAvailable: t.common.latestAvailable,
    periodAsOf: t.common.periodAsOf,
  };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
