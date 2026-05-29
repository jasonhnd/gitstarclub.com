import Link from "next/link";
import type { CSSProperties } from "react";
import { Chrome } from "./_explore/Chrome";
import { RankingList } from "./_explore/RankingList";
import { YEARS, MAX_YEAR_GAINED, LAST_YEAR, topReposForYear } from "./_explore/data";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export default function Home() {
  const thisMonth = topReposForYear(LAST_YEAR).slice(0, 3);

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[68rem] flex-1 py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <h1 className="max-w-[16ch] animate-rise text-[clamp(2.4rem,7vw,5rem)] font-extrabold leading-[1.0] tracking-[-0.04em]">
          A chronicle of <span className="hl">open source</span>.
        </h1>
        <p
          className="mt-5 max-w-[46ch] animate-rise text-[clamp(1rem,1.7vw,1.25rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          Eleven years of momentum at a glance. Pick a year to drop into its chapter.
        </p>

        <section
          className="mt-[clamp(2.5rem,6vw,4.5rem)]"
          aria-label="Stars gained per year, 2015–2026"
        >
          <div
            className="grid h-[clamp(200px,32vw,340px)] items-end gap-1 sm:gap-[1vw]"
            style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}
          >
            {YEARS.map((y, i) => (
              <Link
                key={y.year}
                href={`/${y.year}`}
                aria-label={`${y.year}: ${y.caption}`}
                className="group flex h-full min-w-0 flex-col items-center justify-end gap-3 transition-transform duration-200 ease-[var(--ease-spring)] hover:-translate-y-1.5 active:scale-[0.97]"
              >
                <span className="hidden font-mono text-[0.72rem] tabular-nums text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100 sm:block">
                  {y.gained}M
                </span>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`spine-bar-y w-full rounded-t-xl ${y.peak ? "bg-primary-fixed-dim" : "bg-primary-container"} transition-[filter] duration-200 group-hover:brightness-105`}
                    style={
                      { "--h": y.gained / MAX_YEAR_GAINED, height: "100%", animationDelay: `${0.04 * i}s` } as CSSProperties
                    }
                  />
                </div>
                <span className="font-mono text-[0.7rem] tabular-nums text-on-surface-variant transition-colors group-hover:text-on-surface sm:text-[0.8rem]">
                  {`'${String(y.year).slice(2)}`}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-[clamp(2.5rem,5vw,4rem)] max-w-[42rem]">
          <h2 className="mb-2 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
            This month so far
          </h2>
          <RankingList rows={thisMonth} />
        </section>
      </main>
    </>
  );
}
