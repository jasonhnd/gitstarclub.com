import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { getHotSnapshot, getReposLookup, joinRepoRank } from "@/lib/data";
import { pageMeta } from "@/lib/seo";
import { parseLang, getDictionary, localePrefix } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

export const revalidate = false;

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const loc = parseLang((await params).lang);
  if (!loc) return {};
  return pageMeta({
    title: "Trending GitHub Repos — What's Surging Now",
    description: "What's surging across open source right now: this month's fastest-gaining GitHub repositories and milestone crossings.",
    path: "/trending",
    locale: loc,
  });
}

export default async function TrendingPage({ params }: { params: Promise<{ lang: string }> }) {
  const loc = parseLang((await params).lang);
  if (!loc) notFound();
  const lp = localePrefix(loc);
  const [t, snap, lookup] = await Promise.all([getDictionary(loc), getHotSnapshot(), getReposLookup()]);
  const movers: Row[] =
    snap && lookup
      ? joinRepoRank(snap.home.current_month_top.flow, lookup).map((r) => ({
          owner: r.owner,
          name: r.name,
          lang: r.language,
          gained: r.value,
          total: r.current_stars,
        }))
      : [];
  const onThisDay = (snap?.home.on_this_day ?? []).flatMap((e) => {
    const m = lookup?.[String(e.id)];
    return m ? [{ ...e, full_name: m.full_name, owner: m.owner, name: m.name }] : [];
  });

  return (
    <>
      <Chrome locale={loc} t={t} />
      <main className={`mx-auto w-full max-w-[60rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          {t.trending.title}
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">{t.trending.subtitle}</p>

        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <h2 className="mb-2 flex items-center gap-2 text-[1.3rem] font-extrabold tracking-tight text-on-surface">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /> {t.trending.surging}
          </h2>
          <RankingList rows={movers} variant="gained" locale={loc} />
        </section>

        {onThisDay.length > 0 && (
          <section className="mt-[clamp(2.5rem,5vw,3.5rem)]">
            <h2 className="mb-3 text-[1.2rem] font-extrabold tracking-tight text-on-surface">{t.trending.onThisDay}</h2>
            <ul className="flex flex-col divide-y divide-outline-variant/50">
              {onThisDay.map((e) => (
                <li key={`${e.id}-${e.crossed}`}>
                  <Link href={`${lp}/r/${e.owner}/${e.name}`} className="group grid grid-cols-[1fr_auto] items-center gap-4 py-2.5 transition-colors hover:bg-on-surface/5">
                    <span className="truncate font-mono text-[0.9rem] text-on-surface group-hover:underline group-hover:underline-offset-2">{e.full_name}</span>
                    <span className="font-mono text-[0.82rem] tabular-nums text-on-surface-variant">
                      {t.trending.crossed} <span className="font-semibold text-primary-fixed-dim">{e.crossed}</span> · {e.date}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}
