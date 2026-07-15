import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Chrome } from "@/app/_explore/Chrome";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PageHero } from "@/app/_explore/PageHero";
import { RelatedPages, type RelatedPageItem } from "@/app/_explore/RelatedPages";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getMeta } from "@/lib/data";
import { ANSWER_CAPSULE_SOURCE, formatDataAsOf, resolveDataAsOfLabel, resolveDataAsOfValue, type AnswerCapsuleContent } from "@/lib/geo-capsules";
import { getDictionary, type Dict, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { datasetLd, type FaqItem } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";
import { answerCapsuleLabels } from "./detail-copy";

const ABOUT_PATH = "/about";
const ABOUT_DATASET_VARIABLES = [
  "current_stars",
  "current_stars_sum",
  "rank item value (flow stars added)",
  "curve.monthly total_end",
  "curve.recent_daily net change",
  "milestones.crossed_10k",
  "milestones.crossed_50k",
  "milestones.crossed_100k",
] as const;

export async function generateAboutMetadata(locale: Locale): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    title: t.meta.aboutTitle,
    description: t.meta.aboutDescription,
    path: ABOUT_PATH,
    locale,
  });
}

function Section({ heading, children, id }: { heading: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-[clamp(2.25rem,4.5vw,3.5rem)] max-w-[68ch] scroll-mt-24">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

function FieldList({ items }: { items: Array<{ name: string; description: ReactNode }> }) {
  return (
    <dl className="mt-4 grid gap-3">
      {items.map((item) => (
        <div key={item.name} className="rounded-lg bg-surface-container px-4 py-3">
          <dt className="break-words font-mono text-[0.82rem] font-semibold text-on-surface">{item.name}</dt>
          <dd className="mt-1 text-[0.95rem] text-on-surface-variant">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 grid gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-lg bg-surface-container px-4 py-3 text-[0.98rem] text-on-surface-variant">
          {item}
        </li>
      ))}
    </ul>
  );
}

function HeroActions({ locale, t }: { locale: Locale; t: Dict }) {
  return (
    <>
      <Link href={localizedPath(locale, "/rankings")} className={heroActionClass}>
        {t.about.heroRankings}
      </Link>
      <Link href={localizedPath(locale, "/categories")} className={heroActionClass}>
        {t.about.heroCategories}
      </Link>
    </>
  );
}

const heroActionClass =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline hover:underline-offset-2";

function ArchiveSnapshot({
  t,
  dataAsOf,
  foldedMonth,
}: {
  t: Dict;
  dataAsOf: string | null;
  foldedMonth: string | null;
}) {
  const rows = [
    { label: t.about.snapshotDataAsOf, value: dataAsOf ?? t.about.missingMetadata },
    { label: t.about.snapshotCoverage, value: t.about.coverage },
    { label: t.about.snapshotRuntime, value: t.about.dataModel },
    ...(foldedMonth ? [{ label: t.about.snapshotFoldedThrough, value: foldedMonth }] : []),
  ];

  return (
    <dl className="grid gap-3 rounded-lg border border-outline-variant bg-surface-container px-4 py-4">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant">{row.label}</dt>
          <dd className="mt-1 break-words text-[0.9rem] font-semibold leading-snug text-on-surface">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyMetadataNotice({ text }: { text: string }) {
  return (
    <p className="mt-[clamp(1.75rem,3.5vw,2.5rem)] rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.95rem] leading-relaxed text-on-surface-variant">
      {text}
    </p>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href} rel="noreferrer">
      {children}
    </a>
  );
}

export async function AboutPageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, ABOUT_PATH);
  const href = (path: string) => localizedPath(locale, path);
  const meta = await getMeta();
  const dateModified = resolveDataAsOfValue(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataAsOf = resolveDataAsOfLabel(dateModified, { locale });
  const foldedMonth = formatDataAsOf(meta?.folded_through?.month, locale);
  const capsule: AnswerCapsuleContent | null = dataAsOf
    ? {
        text: t.about.capsuleText.replaceAll("{asOf}", dataAsOf),
        asOf: dataAsOf,
        source: ANSWER_CAPSULE_SOURCE,
      }
    : null;
  const faqItems = buildAboutFaqs(t);
  const relatedItems: RelatedPageItem[] = [
    { href: href("/rankings") as `/${string}`, label: t.nav.rankings },
    { href: href("/categories") as `/${string}`, label: t.nav.categories },
    { href: href("/compare") as `/${string}`, label: t.nav.compare },
  ];
  const dataset = datasetLd({
    name: t.meta.aboutTitle,
    path: routePath,
    locale: language,
    description: t.meta.aboutDescription,
    dateModified,
    keywords: ["GitHub stars", "GH Archive", "GitHub API", "open-source rankings", "star history"],
    variableMeasured: [...ABOUT_DATASET_VARIABLES],
    measurementTechnique:
      "Public GitHub API current totals combined with GH Archive WatchEvent history and deterministic seam-aware anchoring.",
  });

  return (
    <>
      <Chrome locale={locale} canonicalPath={ABOUT_PATH} dictionary={t} />
      <JsonLd data={dataset} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <PageHero
          eyebrow={t.nav.about}
          title={
            <>
              {t.about.heroTitlePre}
              <span className="hl">{t.about.heroTitleAccent}</span>
              {t.about.heroTitlePost}
            </>
          }
          lede={t.about.heroLead}
          actions={<HeroActions locale={locale} t={t} />}
          aside={<ArchiveSnapshot t={t} dataAsOf={dataAsOf} foldedMonth={foldedMonth} />}
        />

        {capsule ? (
          <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={answerCapsuleLabels(locale, t)} />
        ) : (
          <EmptyMetadataNotice text={t.about.cadenceP} />
        )}

        <Section heading={t.about.trackedHeading}>
          <p>{t.about.trackedP1}</p>
          <p>{t.about.trackedP2}</p>
          <BulletList items={[t.about.sample1, t.about.sample2, t.about.sample3, t.about.sample4, t.about.sample5]} />
        </Section>

        <Section heading={t.about.s1h}>
          <p>
            {t.about.s1pPre}
            <ExternalLink href="https://www.gharchive.org/">GH Archive</ExternalLink>
            {t.about.s1pPost}
          </p>
          <p>
            {t.about.ghArchiveCreditPre}
            <ExternalLink href="https://www.gharchive.org/">GH Archive</ExternalLink>
            {t.about.ghArchiveCreditMid}
            <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>
            {t.about.ghArchiveCreditPost}
          </p>
        </Section>

        <Section heading={t.about.rankingHeading}>
          <p>{t.about.rankingP1}</p>
          <p>{t.about.rankingP2}</p>
        </Section>

        <Section heading={t.about.anchorHeading}>
          <p>{t.about.anchorP1}</p>
          <p>
            {foldedMonth ? (
              <>
                {t.about.anchorP2WithMonthPrefix}
                {foldedMonth}
                {t.about.anchorP2WithMonthSuffix}
              </>
            ) : (
              t.about.anchorP2NoMonth
            )}
          </p>
        </Section>

        <Section heading={t.about.categoryHeading}>
          <p>{t.about.categoryP1}</p>
          <p>{t.about.categoryP2}</p>
          <p>
            <Link className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href("/categories")}>
              {t.nav.categories}
            </Link>{" "}
            {t.categories.subtitle}
          </p>
        </Section>

        <Section heading={t.about.fieldsHeading}>
          <FieldList
            items={[
              { name: "current_stars", description: t.about.fieldCurrentStars },
              { name: "current_stars_sum", description: t.about.fieldCurrentStarsSum },
              { name: "rank item value", description: t.about.fieldRankValue },
              { name: "curve.monthly total_end", description: t.about.fieldCurveMonthly },
              { name: "curve.recent_daily net change", description: t.about.fieldRecentDaily },
              { name: "milestones.crossed_10k / crossed_50k / crossed_100k", description: t.about.fieldMilestones },
            ]}
          />
        </Section>

        <Section heading={t.about.archiveHeading}>
          <p>{t.about.archiveP1}</p>
          <p>{t.about.archiveP2}</p>
          <p>
            <Link className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href("/rankings")}>
              {t.nav.rankings}
            </Link>{" "}
            {t.about.archiveCrawlableMid}{" "}
            <Link className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href("/categories")}>
              {t.nav.categories}
            </Link>{" "}
            {t.about.archiveCrawlablePost}
          </p>
        </Section>

        <Section heading={t.about.refreshHeading}>
          <p>{t.about.refreshP1}</p>
          <p>{t.about.refreshP2}</p>
          <p>{t.about.cadenceP}</p>
        </Section>

        <Section heading={t.about.limitationsHeading}>
          <p>
            <strong className="text-on-surface">{t.about.s2aStrong}</strong>
            {t.about.s2aBody}
          </p>
          <p>
            <strong className="text-on-surface">{t.about.s2bStrong}</strong>
            {t.about.s2bBody}
          </p>
          <p>
            <strong className="text-on-surface">{t.about.s2cStrong}</strong>
            {t.about.s2cBody}
          </p>
        </Section>

        <Section heading={t.about.citationHeading} id="citation">
          <p>{t.about.s3p}</p>
          <p>{t.about.citeP}</p>
          <p>{t.about.citationP1}</p>
          <p>{t.about.citationP2}</p>
          <FieldList
            items={[
              { name: "GitStarClub page", description: t.about.citeFieldPage },
              { name: "GH Archive", description: t.about.citeFieldGhArchive },
              { name: "GitHub public API", description: t.about.citeFieldGithubApi },
            ]}
          />
        </Section>

        <Section heading={t.about.exportsHeading}>
          <p>{t.about.exportsP1}</p>
          <p>{t.about.exportsP2}</p>
          <p>
            {t.about.exportsLicensePrefix}{" "}
            <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</ExternalLink>
            . {t.about.exportsAttribution}
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/manifest.json">
                {t.about.exportManifest}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-rankings.csv">
                {t.about.topRankingsCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-rankings.json">
                {t.common.json}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-repo-milestones.csv">
                {t.about.repoMilestonesCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-repo-milestones.json">
                {t.common.json}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-org-aggregates.csv">
                {t.about.orgAggregatesCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href="/data/exports/v1/latest/top-org-aggregates.json">
                {t.common.json}
              </a>
            </li>
          </ul>
          <p>
            <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-EXPORTS.md">
              {t.about.dataExportsDocPrefix}
            </ExternalLink>
          </p>
        </Section>

        <Section heading={t.about.sourceHeading}>
          <p>{t.about.sourceP}</p>
          <FieldList
            items={[
              {
                name: t.about.sourceRepository,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com">github.com/jasonhnd/gitstarclub.com</ExternalLink>,
              },
              {
                name: t.about.corrections,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/issues">GitHub issues</ExternalLink>,
              },
              {
                name: t.about.rankingMethodology,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/RANKING.md">docs/RANKING.md</ExternalLink>,
              },
              {
                name: t.about.categoryMethodology,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/CATEGORIES.md">docs/CATEGORIES.md</ExternalLink>,
              },
              {
                name: t.about.dataContracts,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-CONTRACTS.md">docs/DATA-CONTRACTS.md</ExternalLink>,
              },
              {
                name: t.about.dataExports,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-EXPORTS.md">docs/DATA-EXPORTS.md</ExternalLink>,
              },
              {
                name: t.about.githubApi,
                description: <ExternalLink href="https://docs.github.com/en/graphql">docs.github.com/en/graphql</ExternalLink>,
              },
            ]}
          />
        </Section>

        <RelatedPages title={t.about.relatedTitle} description={t.about.relatedDescription} items={relatedItems} />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function buildAboutFaqs(t: Dict): FaqItem[] {
  return [
    { question: t.about.faqWhatQ, answer: t.about.faqWhatA },
    { question: t.about.faqRankingQ, answer: t.about.faqRankingA },
    { question: t.about.faqGrossNetQ, answer: t.about.faqGrossNetA },
    { question: t.about.faqCategoriesQ, answer: t.about.faqCategoriesA },
    { question: t.about.faqRuntimeQ, answer: t.about.faqRuntimeA },
  ];
}
