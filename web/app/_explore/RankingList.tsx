import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtK } from "@/lib/format";
import { type Locale } from "@/lib/i18n";

export type Row = {
  owner: string;
  name: string;
  lang: string | null;
  total: number;
  gained?: number;
  rate?: number;
  crossedDay?: number;
};
type Variant = "gained" | "rate" | "crossed" | "total";
const STAGGER_CAP_INDEX = 12;

export function rankingStaggerStyle(i: number): CSSProperties | undefined {
  if (i > STAGGER_CAP_INDEX) return undefined;
  return { animationDelay: `${0.04 * Math.min(i, STAGGER_CAP_INDEX)}s` } as CSSProperties;
}

// Editorial ranking — not a data table. Rank as a gold display numeral,
// repo name in the mono "data voice", metric weighted to the right.
// Every row links to its repo page.
export function RankingList({ rows, variant = "gained", startRank = 1 }: { rows: Row[]; variant?: Variant; locale?: Locale; startRank?: number }) {
  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => (
        <li key={`${r.owner}/${r.name}`}>
          <Link
            href={`/${r.owner}/${r.name}`}
            className="group flex min-h-[4.25rem] animate-rise items-center gap-2 overflow-hidden rounded-2xl px-2.5 py-2.5 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-on-surface/5 active:scale-[0.985] sm:gap-4 sm:px-3 sm:py-3"
            style={rankingStaggerStyle(i)}
          >
            <span className="text-readable-gold w-7 shrink-0 text-right text-[1.25rem] font-extrabold tabular-nums sm:w-9 sm:text-[1.5rem]">
              {startRank + i}
            </span>
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <div className="flex min-w-0 items-baseline gap-1 overflow-hidden">
                <span className="max-w-[42%] shrink-0 truncate font-mono text-[0.82rem] text-on-surface-variant sm:text-[0.9rem]">{r.owner}/</span>
                <span className="truncate font-mono text-[0.95rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">
                  {r.name}
                </span>
              </div>
              {r.lang && (
                <span className="mt-1 inline-block w-fit max-w-full truncate whitespace-nowrap rounded-full bg-surface-container-high px-2 py-0.5 text-[0.68rem] font-medium text-on-surface-variant">
                  {r.lang}
                </span>
              )}
            </div>
            <div className="max-w-[6rem] shrink-0 text-right sm:max-w-none">
              {variant === "rate" ? (
                <>
                  <div className="text-[0.95rem] font-extrabold tabular-nums text-on-surface sm:text-[1.05rem]">+{r.rate}%</div>
                  <div className="whitespace-nowrap font-mono text-[0.68rem] text-on-surface-variant sm:text-[0.72rem]">{fmtK(r.total)}★</div>
                </>
              ) : variant === "crossed" ? (
                <>
                  <div className="text-[0.95rem] font-extrabold tabular-nums text-on-surface sm:text-[1.05rem]">{fmtK(r.total)}★</div>
                  <div className="whitespace-nowrap font-mono text-[0.68rem] text-on-surface-variant sm:text-[0.72rem]">10k · day {r.crossedDay}</div>
                </>
              ) : variant === "total" ? (
                <div className="text-[0.95rem] font-extrabold tabular-nums text-on-surface sm:text-[1.05rem]">{fmtK(r.total)}★</div>
              ) : (
                <>
                  <div className="text-[0.95rem] font-extrabold tabular-nums text-on-surface sm:text-[1.05rem]">+{fmtK(r.gained ?? 0)}</div>
                  <div className="whitespace-nowrap font-mono text-[0.68rem] text-on-surface-variant sm:text-[0.72rem]">{fmtK(r.total)}★</div>
                </>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
