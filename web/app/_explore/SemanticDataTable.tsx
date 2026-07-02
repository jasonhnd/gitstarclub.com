import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtK, fmtStars } from "@/lib/format";
import type { Row } from "./RankingList";

type RankingVariant = "gained" | "rate" | "crossed" | "total";
type CellPosition = "first" | "last";

const STAGGER_CAP_INDEX = 12;
const tableWrapClass = "mt-[clamp(1rem,2vw,1.5rem)] overflow-x-auto pb-2";
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

export function RepositoryRankingTable({
  rows,
  variant = "gained",
  startRank = 1,
  caption = "Repository rankings",
}: {
  rows: Row[];
  variant?: RankingVariant;
  startRank?: number;
  caption?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className={tableWrapClass}>
      <table className={tableClass} data-semantic-table="repository-rankings">
        <caption className={captionClass}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${headClass} w-14 text-right`}>
              Rank
            </th>
            <th scope="col" className={headClass}>
              Repository
            </th>
            <th scope="col" className={headClass}>
              Language
            </th>
            {variant !== "total" && (
              <th scope="col" className={`${headClass} text-right`}>
                {metricHeader(variant)}
              </th>
            )}
            <th scope="col" className={`${headClass} text-right`}>
              Total stars
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.owner}/${row.name}`} className="group animate-rise" style={tableStaggerStyle(index)}>
              <td className={cellClass(rankCellClass, "first")}>{startRank + index}</td>
              <th scope="row" className={bodyCellClass}>
                <Link href={`/${row.owner}/${row.name}`} className={linkClass}>
                  {row.owner}/{row.name}
                </Link>
              </th>
              <td className={mutedCellClass}>{row.lang ?? "Unknown"}</td>
              {variant !== "total" && <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>{metricValue(row, variant)}</td>}
              <td className={cellClass(`${bodyCellClass} text-right font-mono font-extrabold tabular-nums`, "last")}>{fmtStars(row.total)}★</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OrganizationRankingTable({
  rows,
  startRank = 1,
  caption = "Organization rankings",
}: {
  rows: OrganizationSummaryRow[];
  startRank?: number;
  caption?: string;
}) {
  if (rows.length === 0) return null;

  return (
    <div className={tableWrapClass}>
      <table className={tableClass} data-semantic-table="organization-rankings">
        <caption className={captionClass}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${headClass} w-14 text-right`}>
              Rank
            </th>
            <th scope="col" className={headClass}>
              Owner
            </th>
            <th scope="col" className={headClass}>
              Owner type
            </th>
            <th scope="col" className={`${headClass} text-right`}>
              Tracked repositories
            </th>
            <th scope="col" className={`${headClass} text-right`}>
              Total stars
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.login} className="group animate-rise" style={tableStaggerStyle(index)}>
              <td className={cellClass(rankCellClass, "first")}>{row.rank ?? startRank + index}</td>
              <th scope="row" className={bodyCellClass}>
                <Link href={`/o/${row.login}`} className={linkClass}>
                  {row.login}
                </Link>
              </th>
              <td className={mutedCellClass}>{row.owner_type ?? "Unknown"}</td>
              <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>{row.repo_count}</td>
              <td className={cellClass(`${bodyCellClass} text-right font-mono font-extrabold tabular-nums`, "last")}>
                {fmtStars(row.current_stars_sum)}★
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CategorySummaryTable({ rows, caption = "Repository categories" }: { rows: CategorySummaryRow[]; caption?: string }) {
  if (rows.length === 0) return null;

  return (
    <div className={tableWrapClass}>
      <table className={tableClass} data-semantic-table="repository-categories">
        <caption className={captionClass}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={headClass}>
              Category
            </th>
            <th scope="col" className={headClass}>
              Dimension
            </th>
            <th scope="col" className={headClass}>
              Slug
            </th>
            <th scope="col" className={`${headClass} text-right`}>
              Tracked repositories
            </th>
            <th scope="col" className={headClass}>
              GitStarClub URL
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
                <td className={`${bodyCellClass} text-right font-mono tabular-nums`}>{row.count}</td>
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

function metricHeader(variant: Exclude<RankingVariant, "total">): string {
  switch (variant) {
    case "rate":
      return "Growth rate percent";
    case "crossed":
      return "10k crossing day";
    case "gained":
      return "Stars gained";
  }
}

function metricValue(row: Row, variant: Exclude<RankingVariant, "total">): number | string {
  switch (variant) {
    case "rate":
      return row.rate == null ? "" : `+${row.rate}%`;
    case "crossed":
      return row.crossedDay == null ? "" : `Day ${row.crossedDay}`;
    case "gained":
      return `+${fmtK(row.gained ?? 0)}`;
  }
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
