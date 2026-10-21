import Link from "../../components/Link";
import { AnswerCapsule } from "@/app/_explore/AnswerCapsule";
import { Breadcrumbs } from "@/app/_explore/Breadcrumbs";
import { FaqBlock } from "@/app/_explore/FaqBlock";
import { PageHero } from "@/app/_explore/PageHero";
import { Star } from "@/app/_explore/Star";
import { PAD_X } from "@/app/_explore/layout-tokens";
import type { ReactNode } from "react";
import type { getMeta } from "@/lib/data";
import { resolveDataAsOfFromMeta } from "@/lib/geo-capsules";
import {
  buildCompareConclusionText,
  formatCompareGain,
} from "@/lib/compare/conclusions";
import { fmtStars } from "@/lib/format";
import { getDictionary, type Locale } from "@/lib/i18n";
import { localizedPath, toBcp47Locale } from "@/lib/i18n/routing";
import { answerCapsuleLabels } from "../../../../web/app/_localized/detail-copy";
import { buildLocalizedCompareCapsule, buildLocalizedCompareFaqs } from "../../../../web/app/_localized/seo-copy";

import { HeroFacts, loadPairConclusions } from "../../../../web/app/_localized/comparison-page-data";

const COMPARE_PATH = "/compare";

export function CompareBody({ locale, t, meta, pairs, children }: {
  locale: Locale; t: Awaited<ReturnType<typeof getDictionary>>;
  meta: Awaited<ReturnType<typeof getMeta>>;
  pairs: Awaited<ReturnType<typeof loadPairConclusions>>;
  children?: ReactNode;
}) {
  const language = toBcp47Locale(locale);
  const routePath = localizedPath(locale, COMPARE_PATH);
  const asOf = resolveDataAsOfFromMeta(meta, { locale });
  const capsule = asOf ? buildLocalizedCompareCapsule(locale, asOf) : null;
  const faqItems = buildLocalizedCompareFaqs(locale, asOf);
  const { conclusions: pairConclusions, unavailablePairs } = pairs;
  const conclusionText = asOf ? buildCompareConclusionText(asOf, pairConclusions, t.compare) : null;
  const hasServerSummary = Boolean(conclusionText && pairConclusions.length > 0);

  return (
    <>
      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-[72rem] flex-1 py-[clamp(1.75rem,4.5vw,4rem)] ${PAD_X}`}>
        <Breadcrumbs locale={locale} dictionary={t} items={[{ path: "nav.home", href: "/" }, { path: "compare.title" }]} />
        <PageHero
          className="mt-5"
          eyebrow={t.nav.compare}
          title={t.compare.title}
          lede={t.compare.subtitle}
          actions={
            <HeroActions
              links={[
                { href: "#compare-workbench", label: t.compare.openCompare },
                ...(hasServerSummary ? [{ href: "#server-compare-title", label: t.compare.serverHeading }] : []),
              ]}
            />
          }
          aside={
            <HeroFacts
              items={[
                ...(asOf ? [{ label: t.common.dataAsOf, value: asOf }] : []),
                { label: t.common.source, value: t.compare.repoCurveSource },
                { label: t.nav.compare, value: t.compare.limit },
              ]}
            />
          }
        />
        {capsule && <AnswerCapsule capsule={capsule} className="mt-[clamp(1.75rem,3.5vw,2.75rem)]" labels={answerCapsuleLabels(locale, t)} />}
        {hasServerSummary && (
          <section aria-labelledby="server-compare-title" className="mt-[clamp(1.5rem,3vw,2.25rem)] rounded-lg border border-outline-variant bg-surface-container px-4 py-4">
            <p className="font-mono text-[0.72rem] uppercase tracking-wider text-on-surface-variant">{t.compare.serverEyebrow}</p>
            <h2 id="server-compare-title" className="mt-2 text-[clamp(1.15rem,2.2vw,1.45rem)] font-extrabold tracking-tight text-on-surface">
              {t.compare.serverHeading}
            </h2>
            <p className="mt-3 max-w-[72ch] text-[0.98rem] leading-relaxed text-on-surface">{conclusionText}</p>
            <ol className="mt-4 divide-y divide-outline-variant border-y border-outline-variant md:hidden" aria-label={t.compare.serverCaption}>
              {pairConclusions.map((row) => (
                <li key={row.label} className="py-3">
                  <div className="break-words font-mono text-[0.82rem] font-semibold text-on-surface">
                    <Link href={localizedPath(locale, `/${row.repos[0].fullName}`)} className="hover:text-primary hover:underline hover:underline-offset-2">
                      {row.repos[0].fullName}
                    </Link>
                    <span className="text-on-surface-variant"> {t.common.versus} </span>
                    <Link href={localizedPath(locale, `/${row.repos[1].fullName}`)} className="hover:text-primary hover:underline hover:underline-offset-2">
                      {row.repos[1].fullName}
                    </Link>
                  </div>
                  <dl className="mt-3 grid gap-2 font-mono text-[0.75rem]">
                    <div>
                      <dt className="uppercase tracking-wider text-on-surface-variant">{t.compare.tenKMonths}</dt>
                      <dd className="mt-0.5 break-words text-on-surface">{row.repos[0].crossed10kLabel} / {row.repos[1].crossed10kLabel}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider text-on-surface-variant">{t.compare.sharedHorizon}</dt>
                      <dd className="mt-0.5 break-words text-on-surface">{row.horizonLabel}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider text-on-surface-variant">{t.compare.fasterAfter10k}</dt>
                      <dd className="mt-0.5 break-words text-on-surface">
                        {row.winner && row.loser ? (
                          <>
                            <span className="font-semibold">{row.winner.fullName}</span>
                            <span className="text-on-surface-variant">
                              {" "}
                              {formatCompareGain(row.winner.gainedAfter10k, locale)} {t.common.versus} {formatCompareGain(row.loser.gainedAfter10k, locale)}
                            </span>
                          </>
                        ) : (
                          <span>
                            {t.common.tiedAt} {formatCompareGain(row.repos[0].gainedAfter10k, locale)}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider text-on-surface-variant">{t.compare.currentStars}</dt>
                      <dd className="mt-0.5 tabular-nums text-on-surface">
                        {fmtStars(row.repos[0].currentStars, locale)}
                        <Star /> / {fmtStars(row.repos[1].currentStars, locale)}
                        <Star />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
            <div className="mt-4 hidden overflow-x-auto md:block">
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
                        <Link href={localizedPath(locale, `/${row.repos[0].fullName}`)} className="hover:text-primary hover:underline hover:underline-offset-2">
                          {row.repos[0].fullName}
                        </Link>
                        <span className="text-on-surface-variant"> {t.common.versus} </span>
                        <Link href={localizedPath(locale, `/${row.repos[1].fullName}`)} className="hover:text-primary hover:underline hover:underline-offset-2">
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
                              {formatCompareGain(row.winner.gainedAfter10k, locale)} {t.common.versus} {formatCompareGain(row.loser.gainedAfter10k, locale)}
                            </span>
                          </>
                        ) : (
                          <span>
                            {t.common.tiedAt} {formatCompareGain(row.repos[0].gainedAfter10k, locale)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pl-4 align-top font-mono text-[0.82rem] tabular-nums text-on-surface-variant">
                        {fmtStars(row.repos[0].currentStars, locale)}
                        <Star /> / {fmtStars(row.repos[1].currentStars, locale)}
                        <Star />
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
        {unavailablePairs.length > 0 && (
          <ul className="mt-4 space-y-2 rounded-lg border border-dashed border-outline-variant bg-surface-container px-4 py-4 text-[0.9rem] text-on-surface-variant">
            {unavailablePairs.map((pair) => (
              <li key={pair.label}>{t.compare.loadError.replace("{repo}", `${pair.a} ${t.common.versus} ${pair.b}`)}</li>
            ))}
          </ul>
        )}
        <section id="compare-workbench" className="mt-[clamp(2.5rem,5vw,4rem)] scroll-mt-24">
          {children}
        </section>
        <FaqBlock items={faqItems} path={routePath} locale={language} heading={t.common.faqHeading} />
      </main>
    </>
  );
}

function HeroActions({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <>
      {links.map((link) => (
        <a key={link.href} href={link.href} className={heroActionClass}>
          {link.label}
        </a>
      ))}
    </>
  );
}

const heroActionClass =
  "text-readable-gold rounded-full border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[0.78rem] transition-colors hover:bg-surface-container-high hover:underline";
