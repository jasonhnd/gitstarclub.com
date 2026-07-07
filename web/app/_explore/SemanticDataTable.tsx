import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtK, fmtStars } from "@/lib/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/routing";
import type { Row } from "./RankingList";

type RankingVariant = "gained" | "rate" | "crossed" | "total";
type CellPosition = "first" | "last";

const STAGGER_CAP_INDEX = 12;
const tableWrapClass = "mt-[clamp(1rem,2vw,1.5rem)] overflow-x-auto pb-2";
const responsiveTableWrapClass = `${tableWrapClass} hidden sm:block`;
const stackWrapClass = "mt-[clamp(1rem,2vw,1.5rem)]";
const tableClass = "w-full min-w-[32rem] border-separate border-spacing-y-2 text-left";
const captionClass = "mb-2 text-left font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant";
const headClass = "px-2.5 pb-1 font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant sm:px-3";
const bodyCellClass =
  "bg-surface-container px-2.5 py-2.5 align-middle text-[0.86rem] text-on-surface transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3";
const mutedCellClass =
  "bg-surface-container px-2.5 py-2.5 align-middle font-mono text-[0.75rem] text-on-surface-variant transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3";
const rankCellClass =
  "text-readable-gold bg-surface-container px-2.5 py-2.5 text-right text-[1.15rem] font-extrabold tabular-nums transition-colors group-hover:bg-surface-container-high sm:px-3 sm:py-3 sm:text-[1.35rem]";
const linkClass = "font-mono font-semibold text-on-surface hover:underline hover:underline-offset-2";

export type OrganizationSummaryRow = {
  rank?: number | null;
  login: string;
  owner_type?: string;
  repo_count: number;
  current_stars_sum: number;
};

export type CategorySummaryRow = {
  id: string;
  dimension: string;
  slug: string;
  label: string;
  count: number;
  path?: string;
};

export type CategorySummaryTableLabels = {
  caption: string;
  category: string;
  dimension: string;
  slug: string;
  trackedRepositories: string;
  gitstarclubUrl: string;
  pendingCount: string;
};

export type RepositoryRankingTableLabels = {
  caption: string;
  rank: string;
  repository: string;
  language: string;
  unknown: string;
  starsGained: string;
  growthRatePercent: string;
  tenKCrossingDay: string;
  day: string;
  totalStars: string;
  rowStarsAdded: string;
};

export type OrganizationRankingTableLabels = {
  caption: string;
  rank: string;
  owner: string;
  ownerType: string;
  unknown: string;
  trackedRepositories: string;
  totalStars: string;
};

export function RepositoryRankingTable({
  rows,
  variant = "gained",
  startRank = 1,
  caption,
  labels,
  locale = DEFAULT_LOCALE,
  compact = false,
}: {
  rows: Row[];
  variant?: RankingVariant;
  startRank?: number;
  caption?: string;
  labels: RepositoryRankingTableLabels;
  locale?: Locale;
  compact?: boolean;
}) {
  if (rows.length === 0) return null;
  const text = labels;

  if (compact) {
    return <RepositoryRankingStack rows={rows} variant={variant} startRank={startRank} caption={caption} labels={text} locale={locale} />;
  }

  return (
    <>
      <RepositoryRankingStack rows={rows} variant={variant} startRank={startRank} caption={caption} labels={text} locale={locale} className="sm:hidden" />
      <div className={responsiveTableWrapClass}>
        <table className={tableClass} data-semantic-table="repository-rankings">
          <caption className={captionClass}>{caption ?? text.caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} w-14 text-right`}>
                {text.rank}
              </th>
              <th scope="col" className={headClass}>
                {text.repository}
              </th>
              <th scope="col" className={headClass}>
                {text.language}
              </th>
              {variant !== "total" && (
                <th scope="col" className={`${headClass} text-right`}>
                  {metricHeader(variant, text)}
                </th>
              )}
              <th scope="col" className={`${headClass} text-right`}>
                {text.totalStars}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const rank = startRank + index;
              return (
                <tr key={`${row.owner}/${row.name}`} className="group animate-rise" style={tableStaggerStyle(index)} aria-label={rowAriaLabel(row, rank, variant, text)}>
                  <td className={cellClass(rankCellClass, "first")}>{rank}</td>
                  <th scope="row" className={bodyCellClass}>
                    <Link href={localizedPath(locale, `/${row.owner}/${row.name}`)} className={linkClass}>
                      {row.owner}/{row.name}
                    </Link>
                  </th>
                  <td className={mutedCellClass}>{row.lang ?? text.unknown}</td>
                  {variant !== "total" && <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>{metricValue(row, variant, text)}</td>}
                  <td className={cellClass(`${bodyCellClass} text-right font-mono font-extrabold tabular-nums`, "last")}>{fmtStars(row.total)}★</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function OrganizationRankingTable({
  rows,
  startRank = 1,
  caption,
  labels,
  locale = DEFAULT_LOCALE,
  compact = false,
}: {
  rows: OrganizationSummaryRow[];
  startRank?: number;
  caption?: string;
  labels: OrganizationRankingTableLabels;
  locale?: Locale;
  compact?: boolean;
}) {
  if (rows.length === 0) return null;
  const text = labels;

  if (compact) {
    return <OrganizationRankingStack rows={rows} startRank={startRank} caption={caption} labels={text} locale={locale} />;
  }

  return (
    <>
      <OrganizationRankingStack rows={rows} startRank={startRank} caption={caption} labels={text} locale={locale} className="sm:hidden" />
      <div className={responsiveTableWrapClass}>
        <table className={tableClass} data-semantic-table="organization-rankings">
          <caption className={captionClass}>{caption ?? text.caption}</caption>
          <thead>
            <tr>
              <th scope="col" className={`${headClass} w-14 text-right`}>
                {text.rank}
              </th>
              <th scope="col" className={headClass}>
                {text.owner}
              </th>
              <th scope="col" className={headClass}>
                {text.ownerType}
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                {text.trackedRepositories}
              </th>
              <th scope="col" className={`${headClass} text-right`}>
                {text.totalStars}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.login} className="group animate-rise" style={tableStaggerStyle(index)}>
                <td className={cellClass(rankCellClass, "first")}>{row.rank ?? startRank + index}</td>
                <th scope="row" className={bodyCellClass}>
                  <Link href={localizedPath(locale, `/o/${row.login}`)} className={linkClass}>
                    {row.login}
                  </Link>
                </th>
                <td className={mutedCellClass}>{row.owner_type ?? text.unknown}</td>
                <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>{row.repo_count}</td>
                <td className={cellClass(`${bodyCellClass} text-right font-mono font-extrabold tabular-nums`, "last")}>
                  {fmtStars(row.current_stars_sum)}★
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function CategorySummaryTable({
  rows,
  caption,
  labels,
}: {
  rows: CategorySummaryRow[];
  caption?: string;
  labels: CategorySummaryTableLabels;
}) {
  if (rows.length === 0) return null;
  const text = labels;

  return (
    <div className={tableWrapClass}>
      <table className={tableClass} data-semantic-table="repository-categories">
        <caption className={captionClass}>{caption ?? text.caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={headClass}>
              {text.category}
            </th>
            <th scope="col" className={headClass}>
              {text.dimension}
            </th>
            <th scope="col" className={headClass}>
              {text.slug}
            </th>
            <th scope="col" className={`${headClass} text-right`}>
              {text.trackedRepositories}
            </th>
            <th scope="col" className={headClass}>
              {text.gitstarclubUrl}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const path = categoryRowPath(row);
            return (
              <tr key={row.id} className="group animate-rise" style={tableStaggerStyle(index)}>
                <th scope="row" className={cellClass(bodyCellClass, "first")}>
                  <Link href={path} className={linkClass}>
                    {row.label}
                  </Link>
                </th>
                <td className={mutedCellClass}>{row.dimension}</td>
                <td className={mutedCellClass}>{row.slug}</td>
                <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>
                  {row.count > 0 ? row.count : text.pendingCount}
                </td>
                <td className={cellClass(mutedCellClass, "last")}>
                  <Link href={path} className="hover:text-on-surface hover:underline hover:underline-offset-2">
                    {path}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function metricHeader(variant: Exclude<RankingVariant, "total">, labels: RepositoryRankingTableLabels): string {
  switch (variant) {
    case "rate":
      return labels.growthRatePercent;
    case "crossed":
      return labels.tenKCrossingDay;
    case "gained":
      return labels.starsGained;
  }
}

function metricValue(row: Row, variant: Exclude<RankingVariant, "total">, labels: RepositoryRankingTableLabels): number | string {
  switch (variant) {
    case "rate":
      return row.rate == null ? "" : `+${row.rate}%`;
    case "crossed":
      return row.crossedDay == null ? "" : `${labels.day} ${row.crossedDay}`;
    case "gained":
      return `+${fmtK(row.gained ?? 0)}`;
  }
}

function rowAriaLabel(row: Row, rank: number, variant: RankingVariant, labels: RepositoryRankingTableLabels): string | undefined {
  if (variant !== "gained") return undefined;
  return fill(labels.rowStarsAdded, { rank: String(rank), stars: fmtK(row.gained ?? 0) });
}

function RepositoryRankingStack({
  rows,
  variant,
  startRank,
  caption,
  labels,
  locale,
  className = "",
}: {
  rows: Row[];
  variant: RankingVariant;
  startRank: number;
  caption?: string;
  labels: RepositoryRankingTableLabels;
  locale: Locale;
  className?: string;
}) {
  return (
    <div className={`${stackWrapClass} ${className}`} data-semantic-list="repository-rankings">
      <p className={captionClass}>{caption ?? labels.caption}</p>
      <ol className="space-y-2">
        {rows.map((row, index) => {
          const rank = startRank + index;
          const metric = variant === "total" ? "" : metricValue(row, variant, labels);

          return (
            <li
              key={`${row.owner}/${row.name}`}
              className="group animate-rise rounded-2xl bg-surface-container px-3 py-3 transition-colors hover:bg-surface-container-high"
              style={tableStaggerStyle(index)}
            >
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
                <span className="text-readable-gold row-span-2 text-right text-[1.1rem] font-extrabold tabular-nums">{rank}</span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <Link href={localizedPath(locale, `/${row.owner}/${row.name}`)} className={`${linkClass} block min-w-0 truncate text-[0.84rem]`}>
                      {row.owner}/{row.name}
                    </Link>
                    <span className="shrink-0 font-mono text-[0.9rem] font-extrabold tabular-nums text-on-surface">{fmtStars(row.total)}★</span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {metric !== "" && <span className="font-mono text-[0.76rem] font-semibold tabular-nums text-readable-gold">{metric}</span>}
                    <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">
                      <span className="truncate">{row.lang ?? labels.unknown}</span>
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function OrganizationRankingStack({
  rows,
  startRank,
  caption,
  labels,
  locale,
  className = "",
}: {
  rows: OrganizationSummaryRow[];
  startRank: number;
  caption?: string;
  labels: OrganizationRankingTableLabels;
  locale: Locale;
  className?: string;
}) {
  return (
    <div className={`${stackWrapClass} ${className}`} data-semantic-list="organization-rankings">
      <p className={captionClass}>{caption ?? labels.caption}</p>
      <ol className="space-y-2">
        {rows.map((row, index) => {
          const rank = row.rank ?? startRank + index;

          return (
            <li key={row.login} className="group animate-rise rounded-2xl bg-surface-container px-3 py-3 transition-colors hover:bg-surface-container-high" style={tableStaggerStyle(index)}>
              <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
                <span className="text-readable-gold row-span-2 text-right text-[1.1rem] font-extrabold tabular-nums">{rank}</span>
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <Link href={localizedPath(locale, `/o/${row.login}`)} className={`${linkClass} block min-w-0 truncate text-[0.84rem]`}>
                      {row.login}
                    </Link>
                    <span className="shrink-0 font-mono text-[0.9rem] font-extrabold tabular-nums text-on-surface">{fmtStars(row.current_stars_sum)}★</span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="inline-flex max-w-full min-w-0 items-center rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">
                      <span className="truncate">{row.owner_type ?? labels.unknown}</span>
                    </span>
                    <span className="font-mono text-[0.72rem] tabular-nums text-on-surface-variant">
                      {row.repo_count} {labels.trackedRepositories}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function tableStaggerStyle(i: number): CSSProperties | undefined {
  if (i > STAGGER_CAP_INDEX) return undefined;
  return { animationDelay: `${0.04 * Math.min(i, STAGGER_CAP_INDEX)}s` } as CSSProperties;
}

function cellClass(base: string, position: CellPosition): string {
  return position === "first" ? `${base} rounded-l-2xl` : `${base} rounded-r-2xl`;
}

function categoryRowPath(row: CategorySummaryRow): string {
  return row.path ?? `/categories/${row.dimension}/${row.slug}`;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}
