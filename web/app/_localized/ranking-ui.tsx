import Link from "next/link";
import type { ReactNode } from "react";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Heatmap } from "@/app/_explore/Heatmap";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { ShareButton } from "@/app/_explore/ShareButton";
import { Star } from "@/app/_explore/Star";
import type { PeriodSwitcherTarget } from "@/app/_explore/PeriodSwitcher";
import { fmtStars } from "@/lib/format";
import type { Dict, Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import type { AvailableRankPeriods } from "@/lib/data/rank-periods";
import { currentUtcPeriods } from "@/lib/periods";
import { availablePeriodLabel, isFallbackMonthPeriod, isFallbackWeekPeriod } from "@/lib/rank-period-labels";
import { repositoryTableLabels } from "./routing";
import { fill } from "./detail-copy";
import { RANKING_FEATURED_LIMIT, type NewcomerRow } from "./ranking-page-data";

export type HeatmapCell = { label: string; gained: number; href?: string };
export type PeriodNavLink = { href: string; label: string; eyebrow: string };

export function EmptyState({ message, className = "", variant = "overview" }: { message: string; className?: string; variant?: "overview" | "detail" }) {
  const shape = variant === "detail" ? "rounded-lg" : "mt-[clamp(1rem,2vw,1.5rem)] rounded-2xl";
  return (
    <p className={`${shape} border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant ${className}`}>
      {message}
    </p>
  );
}

export function periodSwitcherLinks(
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

export function HeroActions({
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

export function PeriodStats({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
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

export function AnswerBlock({
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
      <RankingLeaderLinks rows={rows.slice(0, RANKING_FEATURED_LIMIT)} locale={locale} ariaLabel={leaderLinksLabel} emptyMessage={emptyMessage} />
    </div>
  );
}

function RankingLeaderLinks({ rows, locale, ariaLabel, emptyMessage }: { rows: Row[]; locale: Locale; ariaLabel: string; emptyMessage: string }) {
  if (rows.length === 0) return <EmptyState variant="detail" message={emptyMessage} className="mt-3" />;
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

export function MovementSection({
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
      {cells.length > 0 ? <Heatmap cells={cells} max={Math.max(1, ...cells.map((cell) => cell.gained))} columns={columns ?? cells.length} square={square} labels={labels} locale={locale} /> : <EmptyState variant="detail" message={emptyMessage} />}
    </section>
  );
}

export function RankingMetricGrid({
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
      {rows.length > 0 ? <RankingList rows={rows} variant={variant} locale={locale} tableCaption={tableCaption} labels={labels} compact /> : <EmptyState variant="detail" message={emptyMessage} />}
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
        <EmptyState variant="detail" message={emptyMessage} />
      )}
    </section>
  );
}

export function CompleteRankingSection({
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
      {rows.length > 0 ? <RankingList rows={rows} variant="gained" locale={locale} tableCaption={tableCaption} labels={labels} /> : <EmptyState variant="detail" message={emptyMessage} />}
    </section>
  );
}

export function PeriodNavigation({ title, previous, next }: { title: string; previous: PeriodNavLink | null; next: PeriodNavLink | null }) {
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

