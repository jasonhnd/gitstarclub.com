import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { getHotSnapshot, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { webSiteLd, collectionLd } from "@/lib/jsonld";
import { currentUtcPeriods } from "@/lib/periods";
import { localePrefix, type Dict, type Locale } from "@/lib/i18n";

const PAD_X = "px-[clamp(1.25rem,5vw,2.5rem)]";

type PulseViewProps = {
  locale: Locale;
  t: Dict;
  includeWebsiteLd?: boolean;
};

export async function PulseView({ locale, t, includeWebsiteLd = false }: PulseViewProps) {
  const lp = localePrefix(locale);
  const periods = currentUtcPeriods();
  const [snap, lookup, weekRank] = await Promise.all([
    getHotSnapshot(),
    getReposLookup(),
    getRank("week", periods.weekPeriod, "repo", "flow"),
  ]);

  const weekRows = lookup && weekRank ? toRows(joinRepoRank(weekRank.items.slice(0, 8), lookup)) : [];
  const monthRows = snap && lookup ? toRows(joinRepoRank(snap.current_month.flow.slice(0, 8), lookup)) : [];
  const yearRows = snap && lookup ? toRows(joinRepoRank(snap.current_year.flow.slice(0, 8), lookup)) : [];
  const giants = snap && lookup ? toRows(joinRepoRank(snap.all_time.repo.slice(0, 6), lookup), "total") : [];
  const onThisDay = (snap?.home.on_this_day ?? []).flatMap((e) => {
    const m = lookup?.[String(e.id)];
    return m ? [{ ...e, full_name: m.full_name, owner: m.owner, name: m.name }] : [];
  });

  return (
    <>
      <Chrome locale={locale} t={t} />
      {includeWebsiteLd && <JsonLd data={webSiteLd(locale, lp)} />}
      <JsonLd data={collectionLd(t.trending.title, `${lp}/pulse`, locale)} />
      <main className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="font-mono text-[0.78rem] uppercase tracking-wider text-primary-fixed-dim">{t.nav.trending}</p>
            <h1 className="mt-3 max-w-[13ch] animate-rise text-[clamp(2.6rem,7vw,5.4rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-on-surface">
              {t.trending.title}
            </h1>
            <p className="mt-5 max-w-[48ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">{t.trending.subtitle}</p>
          </div>

          <div className="grid gap-2 rounded-2xl bg-surface-container px-4 py-4">
            <PulseJump href={`${lp}/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`} label={t.week.label} value={periods.weekPeriod} />
            <PulseJump href={`${lp}/rankings/${periods.year}/${periods.month}`} label={t.month.label} value={periods.monthPeriod} />
            <PulseJump href={`${lp}/rankings/${periods.year}`} label={t.year.label} value={String(periods.year)} />
            <PulseJump href={`${lp}/rankings`} label={t.nav.rankings} value="all-time" />
          </div>
        </section>

        <div className="mt-[clamp(2rem,5vw,4rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <PulsePanel title={t.week.top} href={`${lp}/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`} rows={weekRows} locale={locale} />
          <PulsePanel title={t.trending.surging} href={`${lp}/rankings/${periods.year}/${periods.month}`} rows={monthRows} locale={locale} />
          <PulsePanel title={`${t.year.top} ${periods.year}`} href={`${lp}/rankings/${periods.year}`} rows={yearRows} locale={locale} />
        </div>

        <section className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.35rem] font-extrabold tracking-tight text-on-surface">{t.rankings.title}</h2>
                <p className="mt-1 text-[0.9rem] text-on-surface-variant">{t.rankings.subtitle}</p>
              </div>
              <Link href={`${lp}/rankings`} className="font-mono text-[0.78rem] text-primary-fixed-dim hover:underline">
                {t.nav.rankings}
              </Link>
            </div>
            <RankingList rows={giants} variant="total" locale={locale} />
          </div>

          {onThisDay.length > 0 && (
            <aside>
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.trending.onThisDay}</h2>
              <ul className="flex flex-col divide-y divide-outline-variant/50">
                {onThisDay.slice(0, 8).map((e) => (
                  <li key={`${e.id}-${e.crossed}`}>
                    <Link href={`${lp}/r/${e.owner}/${e.name}`} className="group block py-2.5 transition-colors hover:bg-on-surface/5">
                      <span className="block truncate font-mono text-[0.86rem] text-on-surface group-hover:underline group-hover:underline-offset-2">{e.full_name}</span>
                      <span className="font-mono text-[0.75rem] tabular-nums text-on-surface-variant">
                        {t.trending.crossed} <span className="font-semibold text-primary-fixed-dim">{e.crossed}</span> · {e.date}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </section>
      </main>
    </>
  );
}

function toRows(items: ReturnType<typeof joinRepoRank>, mode: "gained" | "total" = "gained"): Row[] {
  return items.map((r) => ({
    owner: r.owner,
    name: r.name,
    lang: r.language,
    gained: mode === "gained" ? r.value : undefined,
    total: r.current_stars,
  }));
}

function PulseJump({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link href={href} className="grid grid-cols-[5rem_1fr] items-baseline gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-on-surface/5">
      <span className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span className="truncate text-right font-mono text-[0.9rem] font-semibold text-on-surface">{value}</span>
    </Link>
  );
}

function PulsePanel({ title, href, rows, locale }: { title: string; href: string; rows: Row[]; locale: Locale }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
        <Link href={href} className="font-mono text-[0.72rem] text-primary-fixed-dim hover:underline">
          open
        </Link>
      </div>
      <RankingList rows={rows} variant="gained" locale={locale} />
    </section>
  );
}
