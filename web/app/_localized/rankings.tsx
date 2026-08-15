import type { Metadata } from "next";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { ArchiveGrid, type ArchiveGridItem } from "@/app/_explore/ArchiveGrid";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PageHero } from "@/app/_explore/PageHero";
import { PeriodSwitcher, type PeriodSwitcherTarget } from "@/app/_explore/PeriodSwitcher";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { Star } from "@/app/_explore/Star";
import { OrganizationRankingTable, type OrganizationSummaryRow } from "@/app/_explore/SemanticDataTable";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getAllTime, getCategoryAssignments, getCategoryRegistry, getHotSnapshot, getOrgsLookup, getReposLookup, joinOrgRank, joinRepoRank } from "@/lib/data";
import { rankingCategoryExits } from "@/lib/ranking-category-exits";
import { RankingCategoryExits } from "./ranking-category-exits";
import { resolveAvailableRankPeriods, type AvailableRankPeriods } from "@/lib/data/rank-periods";
import { formatInteger, fmtStars } from "@/lib/format";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { collectionLd, datasetLd, datasetRef, datasetTemporalCoverageFromYearSpine, itemListLd } from "@/lib/jsonld";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";
import { availablePeriodLabel, isFallbackMonthPeriod, isFallbackWeekPeriod } from "@/lib/rank-period-labels";
import { pageMeta } from "@/lib/seo";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { answerCapsuleLabels } from "./detail-copy";
import { organizationTableLabels, repositoryTableLabels } from "./routing";
import { buildLocalizedAllTimeRankingCapsule, buildLocalizedAllTimeRankingFaqs } from "./seo-copy";

const RANKINGS_PATH = "/rankings";

export async function generateRankingsMetadata(locale: Locale): Promise<Metadata> {
  const t = await getDictionary(locale);
  const snap = await getHotSnapshot();
  const trackedYears = snap?.home.year_spine.length ?? 0;

  return pageMeta({
    title: t.meta.rankingsTitle,
    description: trackedYears ? `${t.meta.rankingsDescriptionPrefix}${trackedYears}${t.meta.rankingsDescriptionSuffix}` : t.rankings.subtitle,
    path: RANKINGS_PATH,
    locale,
  });
}

export async function RankingsPageView({ locale, now = new Date() }: { locale: Locale; now?: Date }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, RANKINGS_PATH);
  const href = (path: string) => localizedPath(locale, path);
  const periods = currentUtcPeriods(now);
  const [repoRank, orgRank, repoLk, orgLk, snap, availablePeriods, registry, assignments] = await Promise.all([
    getAllTime("repo"),
    getAllTime("org"),
    getReposLookup(),
    getOrgsLookup(),
    getHotSnapshot(),
    resolveAvailableRankPeriods(now),
    getCategoryRegistry(),
    getCategoryAssignments(),
  ]);
  const rankedRepos = repoRank && repoLk ? joinRepoRank(repoRank.items, repoLk) : [];
  const repoRows: Row[] = rankedRepos.map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars }));
  const categoryLinks = rankingCategoryExits(rankedRepos, registry, assignments);
  const orgs = orgRank && orgLk ? joinOrgRank(orgRank.items, orgLk) : [];
  const archiveItems = buildArchiveItems(snap?.home.year_spine ?? [], availablePeriods, locale, t);
  const asOf = resolveDataAsOfLabel(repoRank?.meta.generated_at, orgRank?.meta.generated_at, snap?.generated_at, { locale });
  const dateModified = resolveDataAsOfValue(repoRank?.meta.generated_at, orgRank?.meta.generated_at, snap?.generated_at);
  const temporalCoverage = datasetTemporalCoverageFromYearSpine(snap?.home.year_spine);
  const dataset = datasetLd({
    name: t.rankings.datasetName,
    path: routePath,
    locale: language,
    description: t.rankings.subtitle,
    dateModified,
    temporalCoverage,
  });
  const capsule = asOf ? buildLocalizedAllTimeRankingCapsule({ locale, asOf, repoRows, orgRows: orgs }) : null;
  const faqItems = buildLocalizedAllTimeRankingFaqs(locale, { asOf, repoRows, orgRows: orgs });
  const repoLabels = repositoryTableLabels(t);
  const orgLabels = organizationTableLabels(t);

  return (
    <>
      <Chrome locale={locale} canonicalPath={RANKINGS_PATH} dictionary={t} />
      <JsonLd data={collectionLd(t.rankings.title, routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          `${t.rankings.title} ${t.rankings.repositories}`,
          routePath,
          language,
          repoRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: localizedPath(locale, `/${repo.owner}/${repo.name}`) })),
        )}
      />
      <JsonLd
        data={itemListLd(
          `${t.rankings.title} ${t.rankings.organizations}`,
          routePath,
          language,
          orgs.map((org) => ({ name: org.login, path: localizedPath(locale, `/o/${org.login}`) })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <PageHero eyebrow={t.nav.rankings} title={t.rankings.title} lede={t.rankings.subtitle} />

        <div className="mt-[clamp(1.5rem,3vw,2.25rem)]">
          <PeriodSwitcher links={periodSwitcherLinks(availablePeriods, periods, href, locale, t)} activePeriod="all-time" ariaLabel={t.a11y.rankingPeriod} />
        </div>

        <section className="mt-[clamp(1.75rem,4vw,3rem)]">
          {archiveItems.length > 0 ? (
            <ArchiveGrid items={archiveItems} periodType="year" activePeriod={routePath} getHref={(archiveHref) => href(archiveHref)} />
          ) : (
            <EmptyState message={t.categories.rankingPending} className="mt-0" />
          )}
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,4vw,3rem)]" labels={answerCapsuleLabels(locale, t)} />}
        <RankingCategoryExits locale={locale} links={categoryLinks} t={t} />

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-x-10 gap-y-10 lg:grid-cols-2">
          <section className="min-w-0">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.repositories}</h2>
            {repoRows.length > 0 ? (
              <>
                <MobileRepositoryRankingCards rows={repoRows} labels={repoLabels} locale={locale} />
                <div className="hidden md:block">
                  <RankingList rows={repoRows} variant="total" locale={locale} tableCaption={repoLabels.caption} labels={repoLabels} compact />
                </div>
              </>
            ) : (
              <EmptyState message={t.categories.rankingPending} />
            )}
          </section>

          <section className="min-w-0">
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.organizations}</h2>
            {orgs.length > 0 ? (
              <>
                <MobileOrganizationRankingCards rows={orgs} labels={orgLabels} locale={locale} />
                <div className="hidden md:block">
                  <OrganizationRankingTable rows={orgs} caption={orgLabels.caption} labels={orgLabels} locale={locale} compact />
                </div>
              </>
            ) : (
              <EmptyState message={t.categories.rankingPending} />
            )}
          </section>
        </div>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function MobileRepositoryRankingCards({
  rows,
  labels,
  locale,
}: {
  rows: Row[];
  labels: ReturnType<typeof repositoryTableLabels>;
  locale: Locale;
}) {
  return (
    <ol className="mt-[clamp(1rem,2vw,1.5rem)] grid gap-3 md:hidden" aria-label={labels.caption}>
      {rows.map((row, index) => (
        <li key={`${row.owner}/${row.name}`}>
          <Link
            href={localizedPath(locale, `/${row.owner}/${row.name}`)}
            className="block rounded-2xl bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-readable-gold shrink-0 font-mono text-[1.2rem] font-extrabold tabular-nums">#{index + 1}</span>
              <span className="min-w-0 text-right">
                <span className="block font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{labels.totalStars}</span>
                <span className="block font-mono text-[0.95rem] font-extrabold tabular-nums text-on-surface">
                  {fmtStars(row.total, locale)}
                  <Star />
                </span>
              </span>
            </span>
            <span className="mt-2 block break-all font-mono text-[0.95rem] font-semibold text-on-surface">
              {row.owner}/{row.name}
            </span>
            <span className="mt-1 block font-mono text-[0.75rem] text-on-surface-variant">{row.lang ?? labels.unknown}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function MobileOrganizationRankingCards({
  rows,
  labels,
  locale,
}: {
  rows: OrganizationSummaryRow[];
  labels: ReturnType<typeof organizationTableLabels>;
  locale: Locale;
}) {
  return (
    <ol className="mt-[clamp(1rem,2vw,1.5rem)] grid gap-3 md:hidden" aria-label={labels.caption}>
      {rows.map((row, index) => (
        <li key={row.login}>
          <Link
            href={localizedPath(locale, `/o/${row.login}`)}
            className="block rounded-2xl bg-surface-container px-4 py-3 transition-colors hover:bg-surface-container-high"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="text-readable-gold shrink-0 font-mono text-[1.2rem] font-extrabold tabular-nums">#{row.rank ?? index + 1}</span>
              <span className="min-w-0 text-right">
                <span className="block font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{labels.totalStars}</span>
                <span className="block font-mono text-[0.95rem] font-extrabold tabular-nums text-on-surface">
                  {fmtStars(row.current_stars_sum, locale)}
                  <Star />
                </span>
              </span>
            </span>
            <span className="mt-2 block break-all font-mono text-[0.95rem] font-semibold text-on-surface">{row.login}</span>
            <span className="mt-2 grid grid-cols-2 gap-3 font-mono text-[0.75rem] text-on-surface-variant">
              <span>
                <span className="block uppercase tracking-wider">{labels.ownerType}</span>
                <span className="mt-0.5 block text-on-surface">{row.owner_type ?? labels.unknown}</span>
              </span>
              <span className="text-right">
                <span className="block uppercase tracking-wider">{labels.trackedRepositories}</span>
                <span className="mt-0.5 block tabular-nums text-on-surface">{formatInteger(locale, row.repo_count)}</span>
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function EmptyState({ message, className = "" }: { message: string; className?: string }) {
  return (
    <p className={`mt-[clamp(1rem,2vw,1.5rem)] rounded-2xl border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>
      {message}
    </p>
  );
}

export function buildArchiveItems(
  yearSpine: readonly (readonly [string, number])[],
  availablePeriods: AvailableRankPeriods,
  locale: Locale,
  t: Dict,
): ArchiveGridItem[] {
  const years = new Map<number, number>();

  for (const [rawYear, total] of yearSpine) {
    const year = Number(rawYear);
    if (Number.isInteger(year) && total >= 0) years.set(year, total);
  }

  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, total]) => {
      const latestMonth = latestMonthForYear(year, availablePeriods);
      const latestWeek = latestWeekForYear(year, availablePeriods);
      const childrenLinks: ArchiveGridItem["childrenLinks"] = [
        { label: t.year.label, href: `/rankings/${year}` },
        ...(latestMonth ? [{ label: t.rankings.archiveMonths, href: `/rankings/${year}/${latestMonth}`, count: latestMonth }] : []),
        ...(latestWeek ? [{ label: t.rankings.archiveWeeks, href: `/rankings/${year}/W${String(latestWeek).padStart(2, "0")}`, count: latestWeek }] : []),
      ];

      return {
        label: String(year),
        description: t.rankings.archiveDescription,
        href: `/rankings/${year}`,
        count: fill(t.rankings.archiveStarsAdded, { stars: fmtStars(total, locale) }),
        childrenLinks,
      };
    });
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

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function latestMonthForYear(year: number, periods: AvailableRankPeriods): number | null {
  if (periods.month.kind === "month") {
    if (year < periods.month.year) return 12;
    if (year === periods.month.year) return periods.month.month;
  }
  return null;
}

function latestWeekForYear(year: number, periods: AvailableRankPeriods): number | null {
  if (periods.week.kind === "week") {
    if (year < periods.week.year) return weeksInIsoYear(year);
    if (year === periods.week.year) return periods.week.week;
  }
  return null;
}

function weeksInIsoYear(year: number): number {
  return isoWeek(new Date(Date.UTC(year, 11, 28))).week;
}
