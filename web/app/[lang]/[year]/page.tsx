import Link from "next/link";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { getRank, getHeatmap, getReposLookup, joinRepoRank } from "@/lib/data";
import { fmtStars, MONTH_ABBR } from "@/lib/format";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";
const FIRST_YEAR = 2015;
const CURRENT_YEAR = new Date().getUTCFullYear();

export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [{ year: String(CURRENT_YEAR) }];
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string; year: string }> }): Promise<Metadata> {
  const { lang, year } = await params;
  const loc = parseLang(lang);
  if (!loc) return {};
  return pageMeta({
    title: `GitHub Stars in ${year} — Top Trending Repos & Star History`,
    description: `The year ${year} in open source: top GitHub repositories by new stars, breakout projects crossing 10k, and month-by-month star trends.`,
    path: `/${year}`,
    locale: loc,
  });
}

export default async function YearPage({ params }: { params: Promise<{ lang: string; year: string }> }) {
  const { lang, year: yearStr } = await params;
  const loc = parseLang(lang);
  if (!loc) notFound();
  const year = Number(yearStr);
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > CURRENT_YEAR) notFound();

  const [t, rank, heat, lookup] = await Promise.all([
    getDictionary(loc),
    getRank("year", String(year), "repo", "flow"),
    getHeatmap("year", String(year)),
    getReposLookup(),
  ]);
  if (!rank || !lookup) notFound();
  const lp = localePrefix(loc);

  const tops: Row[] = joinRepoRank(rank.items, lookup)
    .slice(0, 20)
    .map((r) => ({ owner: r.owner, name: r.name, lang: r.language, gained: r.value, total: r.current_stars }));
  const months = (heat?.cells ?? []).map(([period, total]) => ({
    label: MONTH_ABBR[Number(String(period).slice(5, 7)) - 1],
    month: Number(String(period).slice(5, 7)),
    gained: total,
  }));
  const maxM = Math.max(1, ...months.map((m) => m.gained));
  const yearTotal = months.reduce((a, m) => a + m.gained, 0);

  const prev = year > FIRST_YEAR ? year - 1 : null;
  const next = year < CURRENT_YEAR ? year + 1 : null;

  return (
    <>
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[64rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Link href={`${lp}/`} className="inline-flex items-center gap-1 font-mono text-[0.78rem] text-on-surface-variant transition-colors hover:text-on-surface">
          ↑ {t.year.all}
        </Link>

        <div className="mt-4 flex items-center justify-between gap-4">
          <NavArrow href={prev ? `${lp}/${prev}` : null} dir="prev" label={prev ? String(prev) : ""} />
          <div className="text-center">
            <div className="font-mono text-[0.75rem] uppercase tracking-wider text-on-surface-variant">{t.year.label}</div>
            <div className="animate-rise text-[clamp(2.5rem,7vw,4.5rem)] font-extrabold leading-none tracking-[-0.04em] text-on-surface">
              {year}
            </div>
          </div>
          <NavArrow href={next ? `${lp}/${next}` : null} dir="next" label={next ? String(next) : ""} />
        </div>
        <p className="mt-3 text-center text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">
          <span className="font-semibold text-on-surface">{fmtStars(yearTotal)}</span> {t.year.gained}
          {tops[0] && (
            <>
              {" · "}
              {t.year.ledBy} <span className="font-semibold text-on-surface">{tops[0].name}</span>
            </>
          )}
        </p>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-8 md:grid-cols-[15rem_1fr]">
          <aside>
            <div className="mb-3 font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">
              {t.year.spine} · {year}
            </div>
            <ol className="flex flex-col gap-1">
              {months.map((m, i) => (
                <li key={m.label}>
                  <Link
                    href={`${lp}/${year}/${m.month}`}
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
              {t.year.top} {year}
            </h2>
            <RankingList rows={tops} locale={loc} />
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
