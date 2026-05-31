import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { Heatmap } from "@/app/_explore/Heatmap";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { getRank, getHeatmap, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars, monthLabel, monthYearLabel } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix, type Locale, type Dict } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const FIRST_YEAR = 2015;
const CURRENT_YEAR = new Date().getUTCFullYear();

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  const now = new Date();
  return [{ year: String(now.getUTCFullYear()), period: String(now.getUTCMonth() + 1) }];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; year: string; period: string }> }): Promise<Metadata> {
  const { lang, year, period } = await params;
  const loc = parseLang(lang);
  if (!loc) return {};
  const wk = /^W(\d{1,2})$/i.exec(period);
  if (wk)
    return pageMeta({
      title: `${year} Week ${Number(wk[1])} — Top Trending GitHub Repos`,
      description: `The top GitHub repositories by new stars in ISO week ${Number(wk[1])} of ${year}.`,
      path: `/${year}/${period}`,
      locale: loc,
    });
  const month = Number(period);
  if (month >= 1 && month <= 12) {
    const mn = monthLabel("en", month, "long");
    return pageMeta({
      title: `Top GitHub Repos in ${mn} ${year} — Trending & Star Growth`,
      description: `${mn} ${year} on GitHub: repositories by new stars, fastest-growing projects, and newcomers crossing 10k.`,
      path: `/${year}/${period}`,
      locale: loc,
    });
  }
  return {};
}

export default async function PeriodPage({ params }: { params: Promise<{ lang: string; year: string; period: string }> }) {
  const { lang, year: ys, period: ps } = await params;
  const loc = parseLang(lang);
  if (!loc) notFound();
  const year = Number(ys);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > CURRENT_YEAR) notFound();
  const t = await getDictionary(loc);

  const wk = /^W(\d{1,2})$/i.exec(ps);
  if (wk) return <WeekView year={year} week={Number(wk[1])} loc={loc} t={t} />;
  const month = Number(ps);
  if (!Number.isInteger(month) || month < 1 || month > 12) notFound();
  return <MonthView year={year} month={month} loc={loc} t={t} />;
}

async function MonthView({ year, month, loc, t }: { year: number; month: number; loc: Locale; t: Dict }) {
  const lp = localePrefix(loc);
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
    ? joinRepoRank(growth.items, lookup).slice(0, 8).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars, rate: r.rate }))
    : [];
  const newcomers: Row[] = newc
    ? joinRepoRank(newc.items, lookup).slice(0, 8).map((r) => ({
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
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { label: t.nav.home, href: lp },
            { label: String(year), href: `${lp}/${year}` },
            { label: monthYearLabel(loc, year, month) },
          ]}
        />
        <div className="mt-4 flex items-center justify-between gap-4">
          <PeriodArrow target={prev && `${lp}/${prev.y}/${prev.m}`} label={prev ? `${monthLabel(loc, prev.m, "short")} '${String(prev.y).slice(2)}` : ""} dir="prev" />
          <div className="text-center">
            <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.month.label}</div>
            <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
              {monthYearLabel(loc, year, month)}
            </h1>
          </div>
          <PeriodArrow target={next && `${lp}/${next.y}/${next.m}`} label={next ? `${monthLabel(loc, next.m, "short")} '${String(next.y).slice(2)}` : ""} dir="next" />
        </div>
        <p className="mt-3 text-center text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          {t.month.gained} <span className="font-semibold text-on-surface">{fmtStars(totalGained)}</span>
          {newcomers.length > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-on-surface">{newcomers.length}</span> {t.month.newcomersWord}
            </>
          )}
        </p>

        {cells.length > 0 && (
          <section className="mt-[clamp(2rem,4vw,3rem)]">
            <h2 className="mb-3 font-mono text-[0.78rem] uppercase tracking-wider text-on-surface-variant">{t.month.daily}</h2>
            <Heatmap cells={cells} max={maxDay} columns={Math.min(16, cells.length)} square />
          </section>
        )}

        <div className="mt-[clamp(2.5rem,5vw,3.5rem)] grid gap-x-8 gap-y-10 md:grid-cols-3">
          <section>
            <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🔥 {t.month.most}</h2>
            <p className="mb-2 text-[0.8rem] text-on-surface-variant">{t.month.mostSub}</p>
            <RankingList rows={mostStars} variant="gained" locale={loc} />
          </section>
          {fastest.length > 0 && (
            <section>
              <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🚀 {t.month.fastest}</h2>
              <p className="mb-2 text-[0.8rem] text-on-surface-variant">{t.month.fastestSub}</p>
              <RankingList rows={fastest} variant="rate" locale={loc} />
            </section>
          )}
          {newcomers.length > 0 && (
            <section>
              <h2 className="mb-1 text-[1.1rem] font-extrabold tracking-tight text-on-surface">🎂 {t.month.newcomers}</h2>
              <p className="mb-2 text-[0.8rem] text-on-surface-variant">{t.month.newcomersSub}</p>
              <RankingList rows={newcomers} variant="crossed" locale={loc} />
            </section>
          )}
        </div>
      </main>
    </>
  );
}

async function WeekView({ year, week, loc, t }: { year: number; week: number; loc: Locale; t: Dict }) {
  if (week < 1 || week > 53) notFound();
  const lp = localePrefix(loc);
  const period = `${year}-W${String(week).padStart(2, "0")}`;
  const [flow, lookup] = await Promise.all([getRank("week", period, "repo", "flow"), getReposLookup()]);
  if (!flow || !lookup) notFound();

  const movers: Row[] = joinRepoRank(flow.items, lookup)
    .slice(0, 24)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));

  return (
    <>
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs
          items={[
            { label: t.nav.home, href: lp },
            { label: String(year), href: `${lp}/${year}` },
            { label: period },
          ]}
        />
        <div className="mt-4 text-center">
          <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.week.label}</div>
          <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
            {period}
          </h1>
        </div>
        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-2 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.week.top}</h2>
          <RankingList rows={movers} variant="gained" locale={loc} />
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
