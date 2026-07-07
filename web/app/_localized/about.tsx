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
import { getDictionary, type Locale } from "@/lib/i18n";
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

const ABOUT_COPY = {
  heroRankings: "Open rankings",
  heroCategories: "Open categories",
  heroLead:
    "GitStarClub is a static archive of public GitHub star history. This page documents what is tracked, how ranking and category views are produced, what the known limits are, and how to cite the derived dataset.",
  missingMetadata: "Published metadata timestamp unavailable",
  dataModel: "Static JSON views",
  coverage: "Public GitHub repositories at 10k or more current stars, with history reconstructed from 2015 onward.",
  runtime: "Pages read precomputed Blob JSON. They do not run live search, database queries, or AI generation during a visitor request.",
  trackedHeading: "What GitStarClub tracks",
  trackedP1:
    "GitStarClub tracks public GitHub repositories that are in the current 10k-star-or-more set. Repository pages, organization pages, rankings, categories, Pulse, compare, and exports all read from the same published view family.",
  trackedP2:
    "Rankings are archive pages, not endorsements. They expose source-backed star totals, period gains, milestones, owner aggregates, and category views so a reader can verify the field behind a claim.",
  rankingHeading: "How rankings are calculated",
  rankingP1:
    "All-time repository rankings use current public GitHub star totals. Organization rankings sum current stars across that owner's tracked repositories. Period rankings use precomputed week, month, or year rank JSON where the visible value is stars gained in that UTC period.",
  rankingP2:
    "Historical stock curves are seam-aware: pre-seam GH Archive gross additions are anchored to GitHub's authoritative star total, then post-seam net changes are added on top of the frozen anchor. Ranking pages render the published order from those precomputed views.",
  categoryHeading: "How categories are assigned",
  categoryP1:
    "Category assignment is deterministic. Rules use stored repository metadata such as primary language, language family, owner kind, curated topics, and keyword predicates. GitStarClub does not use a runtime classifier, LLM, or manual per-request decision for category pages.",
  categoryP2:
    "When metadata is missing or a rule does not meet the public category threshold, the category is omitted or shown through the explicit fallback used by that dimension. Category counts and links come from category registry and assignment JSON.",
  archiveHeading: "Archive permanence",
  archiveP1:
    "Public URLs are intended to remain citeable. Rankings, dated ranking periods, repository pages, organization pages, category pages, and dated export directories keep their canonical URL while newer JSON is published.",
  archiveP2:
    "The /data/exports/v1/latest/ files are convenience aliases to the newest export. For archival citation, prefer the page URL plus data-as-of date, or a dated export directory when using downloadable files.",
  cadenceP:
    "Data dates are shown only when real metadata is available. Missing metadata does not invent freshness; the page falls back to the static methodology and visible source links.",
  limitationsHeading: "Data limitations",
  citationHeading: "How to cite GitStarClub",
  citationP1:
    "For a ranking, repository, organization, category, or comparison claim, cite the GitStarClub page URL, page title, data-as-of date when present, and access date. For downloadable files, cite the manifest or dated export directory rather than only the moving latest alias.",
  citationP2:
    "For star-history facts derived from public event history, credit GH Archive under CC BY 4.0. For transformed rankings, anchored curves, milestones, category pages, and export files, cite GitStarClub as the derived presentation.",
  sourceHeading: "Contact and source links",
  sourceP:
    "Corrections and source review belong in the public repository. The linked methodology documents describe ranking definitions, category rules, data contracts, and export fields.",
  relatedTitle: "Continue from methodology",
  relatedDescription: "Open the permanent ranking and category entry points that use the methodology described here.",
  sourceRepository: "Source repository",
  corrections: "Corrections and issues",
  rankingMethodology: "Ranking methodology",
  categoryMethodology: "Category methodology",
  dataContracts: "Data contracts",
  dataExports: "Data export documentation",
  githubApi: "GitHub API documentation",
  faqWhatQ: "What does GitStarClub track?",
  faqWhatA:
    "GitStarClub tracks public GitHub repositories in the current 10k-star-or-more set and publishes repository, organization, ranking, category, comparison, and export views from precomputed JSON.",
  faqRankingQ: "How should I cite a ranking or chart?",
  faqRankingA:
    "Cite the GitStarClub page URL, title, data-as-of date when shown, and access date. For downloadable files, use the manifest or dated export directory.",
  faqGrossNetQ: "Why can recent daily movement differ from historical gains?",
  faqGrossNetA:
    "Historical GH Archive WatchEvent history is gross additions, while current daily movement is net and can decrease when stars are removed. GitStarClub documents that seam instead of hiding it.",
  faqCategoriesQ: "Are categories assigned by AI?",
  faqCategoriesA:
    "No. Categories are generated from deterministic registry and assignment rules over stored repository metadata; missing metadata degrades through explicit fallbacks.",
  faqRuntimeQ: "Does the About page use live GitHub queries?",
  faqRuntimeA:
    "No. The About page reads only published metadata through getMeta and otherwise renders static methodology, source, and citation copy.",
} as const;

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

function HeroActions({ locale }: { locale: Locale }) {
  return (
    <>
      <Link href={localizedPath(locale, "/rankings")} className={heroActionClass}>
        {ABOUT_COPY.heroRankings}
      </Link>
      <Link href={localizedPath(locale, "/categories")} className={heroActionClass}>
        {ABOUT_COPY.heroCategories}
      </Link>
    </>
  );
}

const heroActionClass =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline hover:underline-offset-2";

function ArchiveSnapshot({ dataAsOf, foldedMonth }: { dataAsOf: string | null; foldedMonth: string | null }) {
  const rows = [
    { label: "Data as of", value: dataAsOf ?? ABOUT_COPY.missingMetadata },
    { label: "Coverage", value: ABOUT_COPY.coverage },
    { label: "Runtime model", value: ABOUT_COPY.dataModel },
    ...(foldedMonth ? [{ label: "Folded through", value: foldedMonth }] : []),
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

function EmptyMetadataNotice() {
  return (
    <p className="mt-[clamp(1.75rem,3.5vw,2.5rem)] rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.95rem] leading-relaxed text-on-surface-variant">
      {ABOUT_COPY.cadenceP}
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
        text: `As of ${dataAsOf}, GitStarClub documents a static-read archive of public GitHub star history. Rankings, categories, repository pages, organization totals, and exports are derived from GH Archive event history, public GitHub API totals, and precomputed JSON views; citation should name the page URL and date. - GitStarClub`,
        asOf: dataAsOf,
        source: ANSWER_CAPSULE_SOURCE,
      }
    : null;
  const faqItems = buildAboutFaqs();
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
              Methodology, sources, and <span className="hl">citation</span>.
            </>
          }
          lede={ABOUT_COPY.heroLead}
          actions={<HeroActions locale={locale} />}
          aside={<ArchiveSnapshot dataAsOf={dataAsOf} foldedMonth={foldedMonth} />}
        />

        {capsule ? (
          <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={answerCapsuleLabels(locale, t)} />
        ) : (
          <EmptyMetadataNotice />
        )}

        <Section heading={ABOUT_COPY.trackedHeading}>
          <p>{ABOUT_COPY.trackedP1}</p>
          <p>{ABOUT_COPY.trackedP2}</p>
          <BulletList items={[t.about.sample1, t.about.sample2, t.about.sample3, t.about.sample4, t.about.sample5]} />
        </Section>

        <Section heading={t.about.s1h}>
          <p>
            {t.about.s1pPre}
            <ExternalLink href="https://www.gharchive.org/">
              GH Archive
            </ExternalLink>
            {t.about.s1pPost}
          </p>
          <p>
            {t.about.ghArchiveCreditPre}
            <ExternalLink href="https://www.gharchive.org/">
              GH Archive
            </ExternalLink>
            {t.about.ghArchiveCreditMid}
            <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">
              CC BY 4.0
            </ExternalLink>
            {t.about.ghArchiveCreditPost}
          </p>
        </Section>

        <Section heading={ABOUT_COPY.rankingHeading}>
          <p>{ABOUT_COPY.rankingP1}</p>
          <p>{ABOUT_COPY.rankingP2}</p>
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

        <Section heading={ABOUT_COPY.categoryHeading}>
          <p>{ABOUT_COPY.categoryP1}</p>
          <p>{ABOUT_COPY.categoryP2}</p>
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

        <Section heading={ABOUT_COPY.archiveHeading}>
          <p>{ABOUT_COPY.archiveP1}</p>
          <p>{ABOUT_COPY.archiveP2}</p>
          <p>
            <Link className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href("/rankings")}>
              {t.nav.rankings}
            </Link>{" "}
            and{" "}
            <Link className="font-semibold text-tertiary hover:text-primary hover:underline hover:underline-offset-[3px]" href={href("/categories")}>
              {t.nav.categories}
            </Link>{" "}
            are the crawlable entry points for the public archive.
          </p>
        </Section>

        <Section heading={t.about.refreshHeading}>
          <p>{t.about.refreshP1}</p>
          <p>{t.about.refreshP2}</p>
          <p>{ABOUT_COPY.cadenceP}</p>
        </Section>

        <Section heading={ABOUT_COPY.limitationsHeading}>
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

        <Section heading={ABOUT_COPY.citationHeading} id="citation">
          <p>{t.about.s3p}</p>
          <p>{t.about.citeP}</p>
          <p>{ABOUT_COPY.citationP1}</p>
          <p>{ABOUT_COPY.citationP2}</p>
          <FieldList
            items={[
              { name: "GitStarClub page", description: "Use the permanent URL, page title, and data-as-of date when available." },
              { name: "GH Archive", description: "Credit the public event archive when reusing event-derived history or WatchEvent-based curves." },
              { name: "GitHub public API", description: "Treat current star totals and repository metadata as public GitHub API facts surfaced through GitStarClub views." },
            ]}
          />
        </Section>

        <Section heading={t.about.exportsHeading}>
          <p>{t.about.exportsP1}</p>
          <p>{t.about.exportsP2}</p>
          <p>
            {t.about.exportsLicensePrefix}{" "}
            <ExternalLink href="https://creativecommons.org/licenses/by/4.0/">
              CC BY 4.0
            </ExternalLink>
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

        <Section heading={ABOUT_COPY.sourceHeading}>
          <p>{ABOUT_COPY.sourceP}</p>
          <FieldList
            items={[
              {
                name: ABOUT_COPY.sourceRepository,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com">github.com/jasonhnd/gitstarclub.com</ExternalLink>,
              },
              {
                name: ABOUT_COPY.corrections,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/issues">GitHub issues</ExternalLink>,
              },
              {
                name: ABOUT_COPY.rankingMethodology,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/RANKING.md">docs/RANKING.md</ExternalLink>,
              },
              {
                name: ABOUT_COPY.categoryMethodology,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/CATEGORIES.md">docs/CATEGORIES.md</ExternalLink>,
              },
              {
                name: ABOUT_COPY.dataContracts,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-CONTRACTS.md">docs/DATA-CONTRACTS.md</ExternalLink>,
              },
              {
                name: ABOUT_COPY.dataExports,
                description: <ExternalLink href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-EXPORTS.md">docs/DATA-EXPORTS.md</ExternalLink>,
              },
              {
                name: ABOUT_COPY.githubApi,
                description: <ExternalLink href="https://docs.github.com/en/graphql">docs.github.com/en/graphql</ExternalLink>,
              },
            ]}
          />
        </Section>

        <RelatedPages title={ABOUT_COPY.relatedTitle} description={ABOUT_COPY.relatedDescription} items={relatedItems} />
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function buildAboutFaqs(): FaqItem[] {
  return [
    { question: ABOUT_COPY.faqWhatQ, answer: ABOUT_COPY.faqWhatA },
    { question: ABOUT_COPY.faqRankingQ, answer: ABOUT_COPY.faqRankingA },
    { question: ABOUT_COPY.faqGrossNetQ, answer: ABOUT_COPY.faqGrossNetA },
    { question: ABOUT_COPY.faqCategoriesQ, answer: ABOUT_COPY.faqCategoriesA },
    { question: ABOUT_COPY.faqRuntimeQ, answer: ABOUT_COPY.faqRuntimeA },
  ];
}
