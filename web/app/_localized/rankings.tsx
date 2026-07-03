import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { RankingList, type Row } from "@/app/_explore/RankingList";
import { OrganizationRankingTable } from "@/app/_explore/SemanticDataTable";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getAllTime, getReposLookup, getOrgsLookup, joinRepoRank, joinOrgRank } from "@/lib/data";
import { monthLabel } from "@/lib/format";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { pageMeta } from "@/lib/seo";
import { collectionLd, datasetLd, datasetRef, itemListLd } from "@/lib/jsonld";
import { resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { currentUtcPeriods, FIRST_YEAR } from "@/lib/periods";
import { organizationTableLabels, repositoryTableLabels } from "./routing";
import { buildLocalizedAllTimeRankingCapsule, buildLocalizedAllTimeRankingFaqs } from "./seo-copy";

const RANKINGS_PATH = "/rankings";

export async function generateRankingsMetadata(locale: Locale): Promise<Metadata> {
  const t = await getDictionary(locale);
  const trackedYears = currentUtcPeriods().year - FIRST_YEAR + 1;
  return pageMeta({
    title: t.meta.rankingsTitle,
    description: `${t.meta.rankingsDescriptionPrefix}${trackedYears}${t.meta.rankingsDescriptionSuffix}`,
    path: RANKINGS_PATH,
    locale,
  });
}

export async function RankingsPageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, RANKINGS_PATH);
  const href = (path: string) => localizedPath(locale, path);
  const periods = currentUtcPeriods();
  const [repoRank, orgRank, repoLk, orgLk] = await Promise.all([
    getAllTime("repo"),
    getAllTime("org"),
    getReposLookup(),
    getOrgsLookup(),
  ]);
  const repoRows: Row[] =
    repoRank && repoLk
      ? joinRepoRank(repoRank.items, repoLk).map((r) => ({ owner: r.owner, name: r.name, lang: r.language, total: r.current_stars }))
      : [];
  const orgs = orgRank && orgLk ? joinOrgRank(orgRank.items, orgLk) : [];
  const asOf = resolveDataAsOfLabel(repoRank?.meta.generated_at, orgRank?.meta.generated_at);
  const dateModified = resolveDataAsOfValue(repoRank?.meta.generated_at, orgRank?.meta.generated_at);
  const dataset = datasetLd({
    name: `${t.rankings.title} Dataset`,
    path: routePath,
    locale: language,
    description: t.rankings.subtitle,
    dateModified,
  });
  const capsule = asOf ? buildLocalizedAllTimeRankingCapsule({ locale, asOf, repoRows, orgRows: orgs }) : null;
  const faqItems = buildLocalizedAllTimeRankingFaqs(locale, { asOf, repoRows, orgRows: orgs });
  const repoLabels = repositoryTableLabels(t);
  const orgLabels = organizationTableLabels(t);

  return (
    <>
      <Chrome locale={locale} canonicalPath={RANKINGS_PATH} dictionary={t} />
      <JsonLd data={collectionLd(t.rankings.title, routePath, language, { dateModified, about: datasetRef(routePath) })} />
      <JsonLd data={dataset} />
      <JsonLd
        data={itemListLd(
          `${t.rankings.title} ${t.rankings.repositories}`,
          routePath,
          language,
          repoRows.map((repo) => ({ name: `${repo.owner}/${repo.name}`, path: `/${repo.owner}/${repo.name}` })),
        )}
      />
      <JsonLd
        data={itemListLd(
          `${t.rankings.title} ${t.rankings.organizations}`,
          routePath,
          language,
          orgs.map((org) => ({ name: org.login, path: `/o/${org.login}` })),
        )}
      />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[68rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <h1 className="animate-rise text-[clamp(2rem,6vw,3.5rem)] font-extrabold leading-none tracking-[-0.03em] text-on-surface">
          {t.rankings.title}
        </h1>
        <p className="mt-3 max-w-[46ch] text-[clamp(0.95rem,1.6vw,1.15rem)] text-on-surface-variant">{t.rankings.subtitle}</p>

        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.5rem,3vw,2.25rem)]" />}

        <section className="mt-[clamp(1.5rem,3vw,2.25rem)] grid gap-3 md:grid-cols-4">
          <HistoryLink href={href(RANKINGS_PATH)} label={t.rankings.allTime} value={t.rankings.repositories} active />
          <HistoryLink href={href(`/rankings/${periods.year}`)} label={t.year.label} value={String(periods.year)} />
          <HistoryLink href={href(`/rankings/${periods.year}/${periods.month}`)} label={t.month.label} value={monthLabel(locale, periods.month, "short")} />
          <HistoryLink href={href(`/rankings/${periods.week.year}/W${String(periods.week.week).padStart(2, "0")}`)} label={t.week.label} value={periods.weekPeriod} />
        </section>

        <section className="mt-[clamp(1rem,2vw,1.5rem)]">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: periods.year - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i)
              .reverse()
              .map((year) => (
                <Link
                  key={year}
                  href={href(`/rankings/${year}`)}
                  className="rounded-full bg-surface-container-high px-3 py-1.5 font-mono text-[0.75rem] text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
                >
                  {year}
                </Link>
              ))}
          </div>
        </section>

        <div className="mt-[clamp(2rem,4vw,3rem)] grid gap-x-10 gap-y-10 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.repositories}</h2>
            <RankingList rows={repoRows} variant="total" locale={locale} tableCaption={repoLabels.caption} labels={repoLabels} />
          </section>
          <section>
            <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{t.rankings.organizations}</h2>
            <OrganizationRankingTable rows={orgs} caption={orgLabels.caption} labels={orgLabels} />
          </section>
        </div>

        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function HistoryLink({ href, label, value, active = false }: { href: string; label: ReactNode; value: ReactNode; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-2xl px-4 py-3 transition-[background-color,transform] duration-200 ease-[var(--ease-spring)] hover:-translate-y-0.5 ${
        active ? "bg-primary-container text-on-primary-container" : "bg-surface-container text-on-surface hover:bg-surface-container-high"
      }`}
    >
      <span className={`block font-mono text-[0.7rem] uppercase tracking-wider ${active ? "" : "opacity-75"}`}>{label}</span>
      <span className="mt-1 block truncate text-[1rem] font-extrabold">{value}</span>
    </Link>
  );
}
