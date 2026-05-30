import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "../../_explore/Chrome";
import { Heatmap } from "../../_explore/Heatmap";
import { RankingList, type Row } from "../../_explore/RankingList";
import { getRank, getHeatmap, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars, MONTH_NAMES, MONTH_ABBR } from "@/lib/format";
import { pageMeta } from "@/lib/seo";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const FIRST_YEAR = 2015;
const CURRENT_YEAR = new Date().getUTCFullYear();

export const dynamicParams = true; // historical periods on demand (ISR)
export const revalidate = false; // cron revalidates current period

export async function generateMetadata({ params }: { params: Promise<{ year: string; period: string }> }): Promise<Metadata> {
  const { year, period } = await params;
  const wk = /^W(\d{1,2})$/i.exec(period);
  if (wk)
    return pageMeta({
      title: `${year} Week ${Number(wk[1])} — Top Trending GitHub Repos`,
      description: `The top GitHub repositories by new stars in ISO week ${Number(wk[1])} of ${year}.`,
      path: `/${year}/${period}`,
    });
  const month = Number(period);
  if (month >= 1 && month <= 12)
    return pageMeta({
      title: `Top GitHub Repos in ${MONTH_NAMES[month - 1]} ${year} — Trending & Star Growth`,
      description: `${MONTH_NAMES[month - 1]} ${year} on GitHub: repositories by new stars, fastest-growing projects, and newcomers crossing 10k.`,
      path: `/${year}/${period}`,
    });
  return {};
}

// Core build: only the current month; history + all weeks are on-demand ISR.
export function generateStaticParams() {
  const now = new Date();
  return [{ year: String(now.getUTCFullYear()), period: String(now.getUTCMonth() + 1) }];
}

// One dynamic segment serves both /YYYY/MM (month) and /YYYY/Www (week) — sibling dynamic
// folders would collide, so the segment branches on the literal "W" prefix.
export default async function PeriodPage({ params }: { params: Promise<{ year: string; period: string }> }) {
  const { year: ys, period: ps } = await params;
  const year = Number(ys);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > CURRENT_YEAR) notFound();

  const wk = /^W(\d{1,2})$/i.exec(ps);
  if (wk) return <WeekView year={year} week={Number(wk[1])} />;

  const month = Number(ps);
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();
  return <MonthView year={year} month={month} />;
}

async function MonthView({ year, month }: { year: number; month: number }) {
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const [flow, growth, newc, heat, lookup] = await Promise.all([
    getRank("month", period, "repo", "flow"),
    getRank("month", period, "repo", "growth"),
    getRank("month", period, "repo", "new"),
    getHeatmap("month", period),
    getReposLookup(),
  ]);
  if (!flow || !lookup) notFound();

  const mostStars: Row[] = joinRepoRank(flow.items, lookup)
    .slice(0, 12)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const fastest: Row[] = growth
    ? joinRepoRank(growth.items, lookup)
        .slice(0, 8)
        .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars, rate: r.rate }))
    : [];
  const newcomers: Row[] = newc
    ? joinRepoRank(newc.items, lookup)
        .slice(0, 8)
        .map((r) => ({
          owner: r.owner,
          name: r.name,
          lang: r.language,
          total: r.current_stars,
          crossedDay: r.date ? Number(r.date.slice(8, 10)) : undefined,
        }))
    : [];

  const cells = (heat?.cells ?? []).map(([date, total]) => ({ label: String(Number(String(date).slice(8, 10))), gained: total }));
  const maxDay = Math.max(1, ...cells.map((c) => c.gained));
  const totalGained = cells.reduce((a, c) => a + c.gained, 0);

  const prev = month > 1 ? { y: year, m: month - 1 } : year > FIRST_YEAR ? { y: year - 1, m: 12 } : null;
  const next = month < 12 ? { y: year, m: month + 1 } : year < CURRENT_YEAR ? { y: year + 1, m: 1 } : null;

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
          <PeriodArrow target={prev && `/${prev.y}/${prev.m}`} label={prev ? `${MONTH_ABBR[prev.m - 1]} '${String(prev.y).slice(2)}` : ""} dir="prev" />
          <div className="text-center">
            <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">Month</div>
            <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
              {MONTH_NAMES[month - 1]} {year}
            </h1>
          </div>
          <PeriodArrow target={next && `/${next.y}/${next.m}`} label={next ? `${MONTH_ABBR[next.m - 1]} '${String(next.y).slice(2)}` : ""} dir="next" />
        </div>
        <p className="mt-3 text-center text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          The tracked universe gained <span className="font-semibold text-on-surface">{fmtStars(totalGained)}</span> stars
          {newcomers.length > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-on-surface">{newcomers.length}</span> newcomers
            </>
          )}
        </p>

        {cells.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">Daily momentum</h2>
            <Heatmap cells={cells} max={maxDay} columns={Math.min(16, cells.length)} square />
          </section>
        )}

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 md:grid-cols-3">
          <section>
            <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🔥 Most stars</h2>
            <p className="mb-2 text-[0.8rem] text-on-surface-variant">Biggest absolute gains</p>
            <RankingList rows={mostStars} variant="gained" />
          </section>
          {fastest.length > 0 && (
            <section>
              <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🚀 Fastest rising</h2>
              <p className="mb-2 text-[0.8rem] text-on-surface-variant">Growth rate, ≥20k floor</p>
              <RankingList rows={fastest} variant="rate" />
            </section>
          )}
          {newcomers.length > 0 && (
            <section>
              <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🎂 Newcomers</h2>
              <p className="mb-2 text-[0.8rem] text-on-surface-variant">First crossed 10k</p>
              <RankingList rows={newcomers} variant="crossed" />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

async function WeekView({ year, week }: { year: number; week: number }) {
  if (week < 1 || week > 53) notFound();
  const period = `${year}-W${String(week).padStart(2, "0")}`;
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();

  const movers: Row[] = joinRepoRank(flow.items, lookup)
    .slice(0, 24)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));

  return (
    <>
      <Chrome />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Link
          href={`/${year}`}
          className="inline-flex items-center gap-1 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:text-on-surface"
        >
          ↑ {year}
        </Link>
        <div className="mt-4 text-center">
          <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">Week</div>
          <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
            {period}
          </h1>
        </div>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-2 text-[1.3rem] font-extrabold tracking-tight text-on-surface">Top movers this week</h2>
          <RankingList rows={movers} variant="gained" />
        </section>
      </main>
    </>
  );
}

function PeriodArrow({ target, label, dir }: { target: string | null | false; label: string; dir: "prev" | "next" }) {
  if (!target) return <span className="w-24" aria-hidden />;
  return (
    <Link
      href={target}
      className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-4 py-2 text-on-surface transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:bg-surface-container-highest active:scale-95"
    >
      {dir === "prev" && <span aria-hidden>‹</span>}
      <span className="font-mono text-[0.8rem] tabular-nums">{label}</span>
      {dir === "next" && <span aria-hidden>›</span>}
    </Link>
  );
}
