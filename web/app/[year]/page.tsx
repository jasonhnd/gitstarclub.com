import Link from "next/link";
import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { Chrome } from "../_explore/Chrome";
import { RankingList } from "../_explore/RankingList";
import { YEARS, FIRST_YEAR, LAST_YEAR, monthsForYear, topReposForYear } from "../_explore/data";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function generateStaticParams() {
  return YEARS.map((y) => ({ year: String(y.year) }));
}

export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yearStr } = await params;
  const year = Number(yearStr);
  const meta = YEARS.find((y) => y.year === year);
  if (!meta) notFound();

  const months = monthsForYear(year);
  const maxM = Math.max(...months.map((m) => m.gained));
  const tops = topReposForYear(year);
  const prev = year > FIRST_YEAR ? year - 1 : null;
  const next = year < LAST_YEAR ? year + 1 : null;

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[64rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:text-on-surface"
        >
          ↑ all years
        </Link>

        <div className="mt-4 flex items-center justify-between gap-4">
          <NavArrow href={prev ? `/${prev}` : null} dir="prev" label={prev ? String(prev) : ""} />
          <div className="text-center">
            <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">Year</div>
            <div className="animate-rise text-[clamp(2.5rem,7vw,4.5rem)] font-extrabold leading-none tracking-[-0.04em] text-on-surface">
              {year}
            </div>
          </div>
          <NavArrow href={next ? `/${next}` : null} dir="next" label={next ? String(next) : ""} />
        </div>
        <p className="mt-3 text-center text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          {meta.caption}
        </p>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-8 md:grid-cols-[15rem_1fr]">
          <aside>
            <div className="mb-3 font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">
              The spine · {year}
            </div>
            <ol className="flex flex-col gap-1">
              {months.map((m, i) => (
                <li key={m.label}>
                  <Link
                    href={`/${year}/${i + 1}`}
                    className="grid grid-cols-[2.4rem_1fr] items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-on-surface/5"
                  >
                    <span className="font-mono text-[0.78rem] tabular-nums text-on-surface-variant">{m.label}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-surface-container-high">
                      <div
                        className="spine-bar h-full rounded-full bg-primary-container"
                        style={{ "--w": m.gained / maxM, animationDelay: `${0.03 * i}s` } as CSSProperties}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </aside>

          <section>
            <h2 className="mb-2 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
              Top movers of {year}
            </h2>
            <RankingList rows={tops} />
          </section>
        </div>
      </main>
    </>
  );
}

function NavArrow({ href, dir, label }: { href: string | null; dir: "prev" | "next"; label: string }) {
  if (!href) return <span className="w-20" aria-hidden />;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-on-surface transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:bg-surface-container-highest active:scale-95"
    >
      {dir === "prev" && <span aria-hidden>‹</span>}
      <span className="font-mono text-[0.85rem] tabular-nums">{label}</span>
      {dir === "next" && <span aria-hidden>›</span>}
    </Link>
  );
}
