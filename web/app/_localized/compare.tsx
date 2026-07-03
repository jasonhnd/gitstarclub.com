import type { Metadata } from "next";
import Link from "next/link";
import { Chrome } from "@/app/_explore/Chrome";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { PAD_X } from "@/app/_explore/layout-tokens";
import { CompareClient } from "@/app/compare/CompareClient";
import { getMeta, getRepoCurve, getRepoIdByFullName } from "@/lib/data";
import { resolveDataAsOfFromMeta } from "@/lib/geo-capsules";
import {
  COMMON_COMPARE_PAIRS,
  buildCompareConclusionText,
  buildComparePairConclusion,
  formatCompareGain,
  type ComparePairConclusion,
} from "@/lib/compare/conclusions";
import { fmtStars } from "@/lib/format";
import { getDictionary, type Locale } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/client-runtime";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { pageMeta } from "@/lib/seo";
import { buildLocalizedCompareCapsule, buildLocalizedCompareFaqs } from "./seo-copy";

const COMPARE_PATH = "/compare";

export async function generateCompareMetadata(locale: Locale): Promise<Metadata> {
  const t = await getDictionary(locale);
  return pageMeta({
    title: t.meta.compareTitle,
    description: t.meta.compareDescription,
    path: COMPARE_PATH,
    locale,
  });
}

export async function ComparePageView({ locale }: { locale: Locale }) {
  const t = await getDictionary(locale);
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, COMPARE_PATH);
  const [meta, repoIds] = await Promise.all([getMeta(), getRepoIdByFullName()]);
  const asOf = resolveDataAsOfFromMeta(meta);
  const capsule = asOf ? buildLocalizedCompareCapsule(locale, asOf) : null;
  const faqItems = buildLocalizedCompareFaqs(locale, asOf);
  const pairConclusions = await loadPairConclusions(repoIds);
  const conclusionText = asOf ? buildCompareConclusionText(asOf, pairConclusions) : null;

  return (
    <>
      <Chrome locale={locale} canonicalPath={COMPARE_PATH} dictionary={t} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] py-[clamp(1.5rem,4vw,3rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "compare.title" }]} />
        <header className="mt-4 animate-rise">
          <h1 className="font-mono text-[clamp(1.4rem,4vw,2.2rem)] font-semibold text-on-surface">{t.compare.title}</h1>
          <p className="mt-3 max-w-[60ch] text-[clamp(1rem,1.5vw,1.1rem)] text-on-surface-variant">{t.compare.subtitle}</p>
        </header>
        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" />}
        {conclusionText && pairConclusions.length > 0 && (
          <section aria-labelledby="server-compare-title" className="mt-[clamp(1.5rem,3vw,2.25rem)] rounded-2xl border border-outline-variant bg-surface-container px-4 py-4">
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.compare.serverEyebrow}</p>
            <h2 id="server-compare-title" className="mt-2 text-[clamp(1.15rem,2.2vw,1.45rem)] font-extrabold tracking-tight text-on-surface">
              {t.compare.serverHeading}
            </h2>
            <p className="mt-3 max-w-[72ch] text-[0.98rem] leading-relaxed text-on-surface">{conclusionText}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-[0.86rem]">
                <caption className="sr-only">{t.compare.serverCaption}</caption>
                <thead className="border-y border-outline-variant font-mono text-[0.7rem] uppercase tracking-wider text-on-surface-variant">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">
                      {t.compare.pair}
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      {t.compare.tenKMonths}
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      {t.compare.sharedHorizon}
                    </th>
                    <th scope="col" className="px-4 py-2 font-semibold">
                      {t.compare.fasterAfter10k}
                    </th>
                    <th scope="col" className="py-2 pl-4 font-semibold">
                      {t.compare.currentStars}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {pairConclusions.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="py-3 pr-4 align-top font-mono text-[0.82rem] font-semibold text-on-surface">
                        <Link href={`/${row.repos[0].fullName}`} className="hover:text-primary hover:underline hover:underline-offset-2">
                          {row.repos[0].fullName}
                        </Link>
                        <span className="text-on-surface-variant"> {t.common.versus} </span>
                        <Link href={`/${row.repos[1].fullName}`} className="hover:text-primary hover:underline hover:underline-offset-2">
                          {row.repos[1].fullName}
                        </Link>
                      </th>
                      <td className="px-4 py-3 align-top text-on-surface-variant">
                        {row.repos[0].crossed10kLabel} / {row.repos[1].crossed10kLabel}
                      </td>
                      <td className="px-4 py-3 align-top text-on-surface-variant">{row.horizonLabel}</td>
                      <td className="px-4 py-3 align-top text-on-surface">
                        {row.winner && row.loser ? (
                          <>
                            <span className="font-semibold">{row.winner.fullName}</span>
                            <span className="text-on-surface-variant">
                              {" "}
                              {formatCompareGain(row.winner.gainedAfter10k)} {t.common.versus} {formatCompareGain(row.loser.gainedAfter10k)}
                            </span>
                          </>
                        ) : (
                          <span>
                            {t.common.tiedAt} {formatCompareGain(row.repos[0].gainedAfter10k)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pl-4 align-top font-mono text-[0.82rem] tabular-nums text-on-surface-variant">
                        {fmtStars(row.repos[0].currentStars)} / {fmtStars(row.repos[1].currentStars)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 grid gap-3 border-t border-outline-variant pt-3 font-mono text-[0.75rem] sm:grid-cols-2">
              <div>
                <dt className="uppercase tracking-wider text-on-surface-variant">{t.common.dataAsOf}</dt>
                <dd className="mt-1 font-semibold text-on-surface">{asOf}</dd>
              </div>
              <div>
                <dt className="uppercase tracking-wider text-on-surface-variant">{t.common.source}</dt>
                <dd className="mt-1 font-semibold text-on-surface">{t.compare.repoCurveSource}</dd>
              </div>
            </dl>
          </section>
        )}
        <section className="mt-[clamp(2rem,4vw,3rem)]">
          <I18nProvider>
            <CompareClient />
          </I18nProvider>
        </section>
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

async function loadPairConclusions(repoIds: Map<string, number>): Promise<ComparePairConclusion[]> {
  const rows = await Promise.all(
    COMMON_COMPARE_PAIRS.map(async (pair) => {
      const aId = repoIds.get(pair.a.toLowerCase());
      const bId = repoIds.get(pair.b.toLowerCase());
      if (aId === undefined || bId === undefined) return null;
      const [a, b] = await Promise.all([getRepoCurve(aId), getRepoCurve(bId)]);
      if (!a || !b) return null;
      return buildComparePairConclusion(pair, a, b);
    }),
  );
  return rows.filter((row): row is ComparePairConclusion => Boolean(row));
}
