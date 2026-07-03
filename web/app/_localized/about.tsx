import type { Metadata } from "next";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { JsonLd } from "@/app/_explore/JsonLd";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { getMeta } from "@/lib/data";
import { formatDataAsOf, resolveDataAsOfLabel, resolveDataAsOfValue } from "@/lib/geo-capsules";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { datasetLd } from "@/lib/jsonld";
import { pageMeta } from "@/lib/seo";

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

function Section({ heading, children }: { heading: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-10 max-w-[62ch]">
      <h2 className="mb-3 text-[1.3rem] font-extrabold tracking-tight text-on-surface">{heading}</h2>
      <div className="flex flex-col gap-3 text-[1.02rem] leading-relaxed text-on-surface-variant">{children}</div>
    </section>
  );
}

function FieldList({ items }: { items: Array<{ name: string; description: string }> }) {
  return (
    <dl className="grid gap-3">
      {items.map((item) => (
        <div key={item.name} className="rounded-lg bg-surface-container px-4 py-3">
          <dt className="font-mono text-[0.82rem] font-semibold text-on-surface">{item.name}</dt>
          <dd className="mt-1 text-[0.95rem] text-on-surface-variant">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-lg bg-surface-container px-4 py-3 text-[0.98rem] text-on-surface-variant">
          {item}
        </li>
      ))}
    </ul>
  );
}

export async function AboutPageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, ABOUT_PATH);
  const meta = await getMeta();
  const dateModified = resolveDataAsOfValue(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month);
  const dataAsOf = resolveDataAsOfLabel(dateModified);
  const foldedMonth = formatDataAsOf(meta?.folded_through?.month);
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
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[60rem] py-[clamp(2rem,5vw,4rem)] ${PAD_X}`}>
        <p className="animate-rise font-mono text-[0.8rem] uppercase tracking-wider text-on-surface-variant">{t.nav.about}</p>
        <h1 className="mt-3 max-w-[16ch] animate-rise text-[clamp(2.2rem,6vw,4rem)] font-extrabold leading-[1.04] tracking-[-0.035em]">
          {t.about.heroPre}
          <span className="hl">{t.about.heroAccent}</span>
          {t.about.heroPost}
        </h1>
        <p
          className="mt-5 max-w-[52ch] animate-rise text-[clamp(1.05rem,1.8vw,1.3rem)] text-on-surface-variant"
          style={{ animationDelay: "0.08s" }}
        >
          {t.about.lead}
        </p>
        {dataAsOf && (
          <p className="mt-4 inline-flex rounded-full bg-surface-container px-3 py-1.5 font-mono text-[0.78rem] text-on-surface-variant">
            {t.common.dataLastUpdated}: {dataAsOf}
          </p>
        )}

        <Section heading={t.about.s1h}>
          <p>
            {t.about.s1pPre}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/">
              GH Archive
            </a>
            {t.about.s1pPost}
          </p>
          <p>
            {t.about.ghArchiveCreditPre}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://www.gharchive.org/" rel="noreferrer">
              GH Archive
            </a>
            {t.about.ghArchiveCreditMid}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
              CC BY 4.0
            </a>
            {t.about.ghArchiveCreditPost}
          </p>
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

        <Section heading={t.about.refreshHeading}>
          <p>{t.about.refreshP1}</p>
          <p>{t.about.refreshP2}</p>
        </Section>

        <Section heading={t.about.sampleHeading}>
          <BulletList items={[t.about.sample1, t.about.sample2, t.about.sample3, t.about.sample4, t.about.sample5]} />
        </Section>

        <Section heading={t.about.s2h}>
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

        <Section heading={t.about.s3h}>
          <p>{t.about.s3p}</p>
          <p>{t.about.citeP}</p>
        </Section>

        <Section heading={t.about.exportsHeading}>
          <p>{t.about.exportsP1}</p>
          <p>{t.about.exportsP2}</p>
          <p>
            {t.about.exportsLicensePrefix}{" "}
            <a className="font-semibold text-tertiary hover:text-primary" href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
              CC BY 4.0
            </a>
            . {t.about.exportsAttribution}
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/manifest.json">
                {t.about.exportManifest}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-rankings.csv">
                {t.about.topRankingsCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-rankings.json">
                {t.common.json}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-repo-milestones.csv">
                {t.about.repoMilestonesCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-repo-milestones.json">
                {t.common.json}
              </a>
            </li>
            <li>
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-org-aggregates.csv">
                {t.about.orgAggregatesCsv}
              </a>{" "}
              ·{" "}
              <a className="font-semibold text-tertiary hover:text-primary" href="/data/exports/v1/latest/top-org-aggregates.json">
                {t.common.json}
              </a>
            </li>
          </ul>
          <p>
            <a className="font-semibold text-tertiary hover:text-primary" href="https://github.com/jasonhnd/gitstarclub.com/blob/main/docs/DATA-EXPORTS.md">
              {t.about.dataExportsDocPrefix}
            </a>
          </p>
        </Section>

        <div className="mt-12">
          <Link
            href={localizedPath(locale, "/")}
            className="inline-flex items-center gap-1 font-semibold text-tertiary transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
          >
            ← {t.about.back}
          </Link>
        </div>
      </main>
    </>
  );
}
