import Link from "next/link";
import { notFound } from "next/navigation";
import { Chrome } from "../../_explore/Chrome";
import { Heatmap } from "../../_explore/Heatmap";
import { RankingList } from "../../_explore/RankingList";
import {
  YEARS,
  FIRST_YEAR,
  LAST_YEAR,
  MONTH_NAMES,
  dailyForMonth,
  monthRankings,
  fmtK,
} from "../../_explore/data";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export function generateStaticParams() {
  return YEARS.flatMap((y) =>
    Array.from({ length: 12 }, (_, m) => ({ year: String(y.year), month: String(m + 1) })),
  );
}

export default async function MonthPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year: ys, month: ms } = await params;
  const year = Number(ys);
  const month = Number(ms);
  if (!YEARS.some((y) => y.year === year) || month < 1 || month > 12) notFound();

  const days = dailyForMonth(year, month);
  const maxDay = Math.max(...days);
  const cells = days.map((g, i) => ({ label: String(i + 1), gained: g }));
  const r = monthRankings(year, month);

  const prev =
    month > 1 ? { y: year, m: month - 1 } : year > FIRST_YEAR ? { y: year - 1, m: 12 } : null;
  const next =
    month < 12 ? { y: year, m: month + 1 } : year < LAST_YEAR ? { y: year + 1, m: 1 } : null;
  const mname = (m: number) => MONTH_NAMES[m - 1].slice(0, 3);

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Link
          href={`/${year}`}
          className="inline-flex items-center gap-1 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:text-on-surface"
        >
          ↑ {year}
        </Link>

        <div className="mt-4 flex items-center justify-between gap-4">
          <MonthArrow target={prev} dir="prev" mname={mname} />
          <div className="text-center">
            <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">Month</div>
            <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
              {MONTH_NAMES[month - 1]} {year}
            </h1>
          </div>
          <MonthArrow target={next} dir="next" mname={mname} />
        </div>
        <p className="mt-3 text-center text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          The tracked universe gained{" "}
          <span className="font-semibold text-on-surface">{fmtK(r.totalGained)}</span> stars ·{" "}
          <span className="font-semibold text-on-surface">{r.newcomerCount}</span> newcomers
        </p>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">
            Daily momentum
          </h2>
          <Heatmap cells={cells} max={maxDay} columns={Math.min(16, days.length)} square />
        </section>

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 md:grid-cols-3">
          <section>
            <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🔥 Most stars</h2>
            <p className="mb-2 text-[0.8rem] text-on-surface-variant">Biggest absolute gains</p>
            <RankingList rows={r.topNew} variant="gained" />
          </section>
          <section>
            <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🚀 Fastest rising</h2>
            <p className="mb-2 text-[0.8rem] text-on-surface-variant">Growth rate, ≥20k floor</p>
            <RankingList rows={r.topGrowth} variant="rate" />
          </section>
          <section>
            <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🎂 Newcomers</h2>
            <p className="mb-2 text-[0.8rem] text-on-surface-variant">First crossed 10k</p>
            <RankingList rows={r.newcomers} variant="crossed" />
          </section>
        </div>
      </main>
    </>
  );
}

function MonthArrow({
  target,
  dir,
  mname,
}: {
  target: { y: number; m: number } | null;
  dir: "prev" | "next";
  mname: (m: number) => string;
}) {
  if (!target) return <span className="w-24" aria-hidden />;
  return (
    <Link
      href={`/${target.y}/${target.m}`}
      className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-on-surface transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:bg-surface-container-highest active:scale-95"
    >
      {dir === "prev" && <span aria-hidden>‹</span>}
      <span className="font-mono text-[0.8rem] tabular-nums">
        {mname(target.m)} {String(target.y).slice(2)}
      </span>
      {dir === "next" && <span aria-hidden>›</span>}
    </Link>
  );
}
