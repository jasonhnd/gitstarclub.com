import type { CSSProperties } from "react";
import Link from "next/link";
import { fmtStars } from "@/lib/format";

type Cell = { label: string; gained: number; href?: string };

// Tonal amber heatmap — intensity ramps surface-container → primary-fixed-dim.
// Deliberately NOT the GitHub green grid; recolored into the brand world.
// `square` + `columns` give a calendar-style daily grid.
export function Heatmap({
  cells,
  max,
  columns,
  square = false,
}: {
  cells: Cell[];
  max: number;
  columns?: number;
  square?: boolean;
}) {
  const cols = columns ?? cells.length;
  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(${square ? "1.75rem" : "0"}, 1fr))` }}
      >
        {cells.map((c, i) => {
          const t = Math.max(0.08, Math.min(1, c.gained / max));
          const label = `${c.label}: ${fmtStars(c.gained)} stars added`;
          const fill = `color-mix(in oklab, var(--md-sys-color-primary-fixed-dim) ${Math.round(
            t * 100,
          )}%, var(--md-sys-color-surface-container))`;
          const inner = (
            <>
              <div
                className={`relative w-full overflow-hidden rounded-xl ring-1 ring-outline-variant/30 transition-transform duration-200 ease-[var(--ease-spring)] group-hover:-translate-y-0.5 ${square ? "aspect-square" : "h-20"}`}
              >
                <div
                  className="absolute inset-0 animate-rise"
                  style={{ background: fill, animationDelay: `${i * 0.02}s` } as CSSProperties}
                />
              </div>
              <span className="font-mono text-[0.7rem] text-on-surface-variant">{c.label}</span>
            </>
          );
          return c.href ? (
            <Link key={c.label} href={c.href} aria-label={label} title={label} className="group flex flex-col items-center gap-1.5">
              {inner}
            </Link>
          ) : (
            <div key={c.label} role="img" aria-label={label} title={label} className="group flex flex-col items-center gap-1.5">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
