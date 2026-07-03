import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getHotSnapshot, getRank, getReposLookup, joinRepoRank } from "@/lib/data";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { webSiteLd, collectionLd, datasetLd, datasetRef, datasetTemporalCoverageFromYearSpine, siteOrganizationLd } from "@/lib/jsonld";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { currentUtcPeriods, isoWeek } from "@/lib/periods";
import { pageMeta } from "@/lib/seo";
import { repositoryTableLabels } from "./routing";
import { buildLocalizedPulseCapsule, buildLocalizedPulseFaqs } from "./seo-copy";

export async function generatePulseMetadata({
  locale,
  canonicalPath,
  absoluteTitle = false,
}: {
  locale: Locale;
  canonicalPath: "/" | "/pulse";
  absoluteTitle?: boolean;
}): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    absoluteTitle,
    title: absoluteTitle ? `${t.meta.homeTitle} · GitStarClub` : t.meta.pulseTitle,
    description: canonicalPath === "/" ? t.meta.homeDescription : t.meta.pulseDescription,
    path: canonicalPath,
    locale,
  });
}

type PulseViewProps = {
  locale: Locale;
  canonicalPath: "/" | "/pulse";
  includeWebsiteLd?: boolean;
};

export async function PulsePageView({ locale, canonicalPath, includeWebsiteLd = false }: PulseViewProps) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, canonicalPath);
  const href = (path: string) => localizedPath(locale, path);
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
  const asOf = resolveDataAsOfLabel(snap?.generated_at, activeWeek.rank?.meta.generated_at);
  const dateModified = resolveDataAsOfValue(snap?.generated_at, activeWeek.rank?.meta.generated_at);
  const temporalCoverage = datasetTemporalCoverageFromYearSpine(snap?.home.year_spine);
  const dataset = datasetLd({
    name: `${t.pulse.title} Dataset`,
    path: routePath,
    locale: language,
    description: t.meta.pulseDescription,
    dateModified,
    temporalCoverage,
  });
  const capsule = asOf
    ? buildLocalizedPulseCapsule({ locale, asOf, weekRows, monthRows, activeWeek: activeWeek.period, activeMonth: periods.monthPeriod })
    : null;
  const faqItems = buildLocalizedPulseFaqs(locale, { asOf, weekRows, monthRows, activeWeek: activeWeek.period, activeMonth: periods.monthPeriod });
  const onThisDay = (snap?.home.on_this_day ?? []).flatMap((e) => {
    const m = lookup?.[String(e.id)];
    return m ? [{ ...e, full_name: m.full_name, owner: m.owner, name: m.name }] : [];
  });
  const repoLabels = repositoryTableLabels(t);

  return (
    <>
      <Chrome locale={locale} canonicalPath={canonicalPath} dictionary={t} />
      {includeWebsiteLd && <JsonLd data={siteOrganizationLd()} />}
      {includeWebsiteLd && <JsonLd data={webSiteLd(language, routePath, { dateModified, about: datasetRef(routePath) })} />}
      <JsonLd data={collectionLd(t.pulse.title, routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <p className="text-readable-gold font-mono text-[0.78rem] uppercase tracking-wider">{t.nav.pulse}</p>
            <h1 className="mt-3 max-w-[13ch] animate-rise text-[clamp(2.6rem,7vw,5.4rem)] font-extrabold leading-[0.98] tracking-[-0.04em] text-on-surface">
              {t.pulse.title}
            </h1>
            <p className="mt-5 max-w-[48ch] text-[clamp(1rem,1.7vw,1.2rem)] text-on-surface-variant">{t.pulse.subtitle}</p>
          </div>

          <div className="grid gap-2 rounded-2xl bg-surface-container px-4 py-4">
            <PulseJump href={href(weekHref(activeWeek))} label={t.week.label} value={activeWeek.period} />
            <PulseJump href={href(`/rankings/${periods.year}/${periods.month}`)} label={t.month.label} value={periods.monthPeriod} />
            <PulseJump href={href(`/rankings/${periods.year}`)} label={t.year.label} value={String(periods.year)} />
            <PulseJump href={href("/rankings")} label={t.nav.rankings} value={t.common.allTime} />
          </div>
        </section>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,4vw,3rem)]" />}

        <div className="mt-[clamp(2rem,5vw,4rem)] grid gap-x-8 gap-y-10 lg:grid-cols-3">
          <PulsePanel title={t.week.top} href={href(weekHref(activeWeek))} meta={activeWeek.period} rows={weekRows} labels={repoLabels} openLabel={t.pulse.open} />
          <PulsePanel title={t.pulse.surging} href={href(`/rankings/${periods.year}/${periods.month}`)} meta={periods.monthPeriod} rows={monthRows} labels={repoLabels} openLabel={t.pulse.open} />
          <PulsePanel
            title={
              <>
                {t.year.top} {periods.year}
              </>
            }
            href={href(`/rankings/${periods.year}`)}
            meta={String(periods.year)}
            rows={yearRows}
            labels={repoLabels}
            openLabel={t.pulse.open}
          />
        </div>

        <section className="mt-[clamp(2.5rem,5vw,4rem)] grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div>
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-[1.35rem] font-extrabold tracking-tight text-on-surface">{t.rankings.title}</h2>
                <p className="mt-1 text-[0.9rem] text-on-surface-variant">{t.rankings.subtitle}</p>
              </div>
              <Link href={href("/rankings")} className="text-readable-gold font-mono text-[0.78rem] hover:underline">
                {t.nav.rankings}
              </Link>
            </div>
            <RankingList rows={giants} variant="total" locale={locale} labels={repoLabels} />
          </div>

          {onThisDay.length > 0 && (
            <aside>
              <h2 className="mb-3 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{t.pulse.onThisDay}</h2>
              <ul className="flex flex-col divide-y divide-outline-variant/50">
                {onThisDay.slice(0, 8).map((e) => (
                  <li key={`${e.id}-${e.crossed}`}>
                    <Link href={`/${e.owner}/${e.name}`} className="group block py-2.5 transition-colors hover:bg-on-surface/5">
                      <span className="block truncate font-mono text-[0.86rem] text-on-surface group-hover:underline group-hover:underline-offset-2">{e.full_name}</span>
                      <span className="font-mono text-[0.75rem] tabular-nums text-on-surface-variant">
                        {t.pulse.crossed} <span className="text-readable-gold font-semibold">{e.crossed}</span> · {e.date}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </section>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
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

function PulsePanel({
  title,
  href,
  meta,
  rows,
  labels,
  openLabel,
}: {
  title: ReactNode;
  href: string;
  meta?: string;
  rows: Row[];
  labels: ReturnType<typeof repositoryTableLabels>;
  openLabel: string;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 text-[1.15rem] font-extrabold tracking-tight text-on-surface">{title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          {meta && <span className="rounded-full border border-outline-variant px-2 py-0.5 font-mono text-[0.68rem] text-on-surface-variant">{meta}</span>}
          <Link href={href} className="text-readable-gold font-mono text-[0.72rem] hover:underline">
            {openLabel}
          </Link>
        </div>
      </div>
      <RankingList rows={rows} variant="gained" labels={labels} />
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
