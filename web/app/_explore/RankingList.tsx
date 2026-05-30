import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtK } from "@/lib/format";

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

// Editorial ranking — not a data table. Rank as a gold display numeral,
// repo name in the mono "data voice", metric weighted to the right.
// Every row links to its repo page.
export function RankingList({ rows, variant = "gained" }: { rows: Row[]; variant?: Variant }) {
  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => (
        <li key={`${r.owner}/${r.name}`}>
          <Link
            href={`/r/${r.owner}/${r.name}`}
            className="group flex animate-rise items-center gap-4 rounded-2xl px-3 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 hover:bg-on-surface/5 active:scale-[0.985]"
            style={{ animationDelay: `${0.04 * i}s` } as CSSProperties}
          >
            <span className="w-9 shrink-0 text-right text-[1.5rem] font-extrabold tabular-nums text-primary-fixed-dim">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1">
                <span className="truncate font-mono text-[0.9rem] text-on-surface-variant">{r.owner}/</span>
                <span className="truncate font-mono text-[0.95rem] font-semibold text-on-surface group-hover:underline group-hover:underline-offset-2">
                  {r.name}
                </span>
              </div>
              {r.lang && (
                <span className="mt-1 inline-block rounded-full bg-surface-container-high px-2 py-0.5 text-[0.68rem] font-medium text-on-surface-variant">
                  {r.lang}
                </span>
              )}
            </div>
            <div className="shrink-0 text-right">
              {variant === "rate" ? (
                <>
                  <div className="text-[1.05rem] font-extrabold tabular-nums text-on-surface">+{r.rate}%</div>
                  <div className="font-mono text-[0.72rem] text-on-surface-variant">{fmtK(r.total)}★</div>
                </>
              ) : variant === "crossed" ? (
                <>
                  <div className="text-[1.05rem] font-extrabold tabular-nums text-on-surface">{fmtK(r.total)}★</div>
                  <div className="font-mono text-[0.72rem] text-on-surface-variant">10k · day {r.crossedDay}</div>
                </>
              ) : variant === "total" ? (
                <div className="text-[1.05rem] font-extrabold tabular-nums text-on-surface">{fmtK(r.total)}★</div>
              ) : (
                <>
                  <div className="text-[1.05rem] font-extrabold tabular-nums text-on-surface">+{fmtK(r.gained ?? 0)}</div>
                  <div className="font-mono text-[0.72rem] text-on-surface-variant">{fmtK(r.total)}★</div>
                </>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
