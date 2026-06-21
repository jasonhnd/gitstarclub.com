import type { ReactNode } from "react";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { T } from "@/lib/i18n/client";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import en from "@/lib/i18n/dictionaries/en";
import { getHotSnapshot, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { webSiteLd, collectionLd } from "@/lib/jsonld";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";

// Locale-neutral body: data formatting uses the default locale (English) so the page is
// static. Chrome labels are rendered via <T> and swapped to the cookie locale after hydration.
const LOC = DEFAULT_LOCALE;

type PulseViewProps = {
  includeWebsiteLd?: boolean;
};

export async function PulseView({ includeWebsiteLd = false }: PulseViewProps) {
  const now = new Date();
  const periods = currentUtcPeriods(now);
  const weekCandidates = recentWeekCandidates(now, 8);
  const [snap, lookup, ...weekRanks] = await Promise.all([
    getHotSnapshot(),
    getReposLookup(),
    ...weekCandidates.map((week) => getRank("week", week.period, "repo", "flow")),
  ]);

  let activeWeek = { ...weekCandidates[0], rank: null as Awaited<ReturnType<typeof getRank>> };
  for (const [index, rank] of weekRanks.entries()) {
    if (rank && rank.items.length > 0) {
      activeWeek = { ...weekCandidates[index], rank };
      break;
    }
  }

  const weekRows = lookup && activeWeek.rank ? toRows(joinRepoRank(activeWeek.rank.items.slice(0, 8), lookup)) : [];
  const monthRows = snap && lookup ? toRows(joinRepoRank(snap.current_month.flow.slice(0, 8), lookup)) : [];
  const yearRows = snap && lookup ? toRows(joinRepoRank(snap.current_year.flow.slice(0, 8), lookup)) : [];
  const giants = snap && lookup ? toRows(joinRepoRank(snap.all_time.repo.slice(0, 6), lookup), "total") : [];
  const onThisDay = (snap?.home.on_this_day ?? []).flatMap((e) => {
    const m = lookup?.[String(e.id)];
    return m ? [{ ...e, full_name: m.full_name, owner: m.owner, name: m.name }] : [];
  });

  return (
    <>
      <Chrome />
      {includeWebsiteLd && <JsonLd data={webSiteLd(LOC, "/")} />}
      <JsonLd data={collectionLd(en.pulse.title, "/pulse", LOC)} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="font-mono text-[0.78rem] uppercase tracking-wider text-accent-text">
              <T path="nav.pulse" />
            </p>
            <h1 className="mt-3 max-w-[13ch] animate-rise text-[var(--type-display-lg)] font-extrabold leading-[0.98] tracking-[-0.04em] text-on-surface">
              <T path="pulse.title" />
            </h1>
            <p className="mt-5 max-w-[48ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">
              <T path="pulse.subtitle" />
            </p>
          </div>

          <div className="grid gap-2 rounded-2xl bg-surface-container-low px-4 py-4">
            <PulseJump href={weekHref(activeWeek)} label={<T path="week.label" />} value={activeWeek.period} />
            <PulseJump href={`/rankings/${periods.year}/${periods.month}`} label={<T path="month.label" />} value={periods.monthPeriod} />
            <PulseJump href={`/rankings/${periods.year}`} label={<T path="year.label" />} value={String(periods.year)} />
            <PulseJump href="/rankings" label={<T path="nav.rankings" />} value="all-time" />
          </div>
        </section>

        <div className="mt-[clamp(2rem,5vw,4rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <PulsePanel title={<T path="week.top" />} href={weekHref(activeWeek)} meta={activeWeek.period} rows={weekRows} />
          <PulsePanel title={<T path="pulse.surging" />} href={`/rankings/${periods.year}/${periods.month}`} meta={periods.monthPeriod} rows={monthRows} />
          <PulsePanel
            title={
              <>
                <T path="year.top" /> {periods.year}
              </>
            }
            href={`/rankings/${periods.year}`}
            meta={String(periods.year)}
            rows={yearRows}
          />
        </div>

        <section className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.35rem] font-extrabold tracking-tight text-on-surface">
                  <T path="rankings.title" />
                </h2>
                <p className="mt-1 text-[0.9rem] text-on-surface-variant">
                  <T path="rankings.subtitle" />
                </p>
              </div>
              <Link href="/rankings" className="font-mono text-[0.78rem] text-accent-text hover:underline">
                <T path="nav.rankings" />
              </Link>
            </div>
            <RankingList rows={giants} variant="total" locale={LOC} />
          </div>

          {onThisDay.length > 0 && (
            <aside>
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">
                <T path="pulse.onThisDay" />
              </h2>
              <ul className="flex flex-col divide-y divide-outline-variant/50">
                {onThisDay.slice(0, 8).map((e) => (
                  <li key={`${e.id}-${e.crossed}`}>
                    <Link href={`/${e.owner}/${e.name}`} className="group block py-2.5 transition-colors hover:bg-on-surface/5">
                      <span className="block truncate font-mono text-[0.86rem] text-on-surface group-hover:underline group-hover:underline-offset-2">{e.full_name}</span>
                      <span className="font-mono text-[0.75rem] tabular-nums text-on-surface-variant">
                        <T path="pulse.crossed" /> <span className="font-semibold text-accent-text">{e.crossed}</span> · {e.date}
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

function PulseJump({ href, label, value }: { href: string; label: ReactNode; value: string }) {
  return (
    <Link href={href} className="grid grid-cols-[5rem_1fr] items-baseline gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-on-surface/5">
      <span className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span className="truncate text-right font-mono text-[0.9rem] font-semibold text-on-surface">{value}</span>
    </Link>
  );
}

function PulsePanel({ title, href, meta, rows }: { title: ReactNode; href: string; meta?: string; rows: Row[] }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {meta && <span className="rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">{meta}</span>}
          <Link href={href} className="font-mono text-[0.72rem] text-accent-text hover:underline">
            <T path="pulse.open" />
          </Link>
        </div>
      </div>
      <RankingList rows={rows} variant="gained" locale={LOC} />
    </section>
  );
}

type WeekCandidate = {
  year: number;
  week: number;
  period: string;
};

function recentWeekCandidates(now: Date, count: number): WeekCandidate[] {
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() + 1 - day);

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() - index * 7);
    const week = isoWeek(date);
    return {
      ...week,
      period: `${week.year}-W${String(week.week).padStart(2, "0")}`,
    };
  });
}

function weekHref(week: WeekCandidate) {
  return `/rankings/${week.year}/W${String(week.week).padStart(2, "0")}`;
}
