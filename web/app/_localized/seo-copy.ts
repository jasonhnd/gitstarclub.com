import type { Locale } from "@/lib/i18n";
import { fmtStars, formatInteger } from "@/lib/format";
import { SEO_TEXT as copy } from "./detail-copy/tables";
import { fill, rankValues } from "./detail-copy/format";
import { ANSWER_CAPSULE_SOURCE, type AnswerCapsuleContent, type CapsuleOrgRankRow, type CapsuleRankRow } from "@/lib/geo-capsules";
import type { FaqItem } from "@/lib/jsonld";

type PulseFaqInput = {
  asOf: string | null;
  weekRows: readonly CapsuleRankRow[];
  monthRows: readonly CapsuleRankRow[];
  activeWeek: string;
  activeMonth: string;
};

type RankingsFaqInput = {
  asOf: string | null;
  repoRows: readonly CapsuleRankRow[];
  orgRows: readonly CapsuleOrgRankRow[];
};

export function buildLocalizedPulseCapsule({
  locale,
  asOf,
  weekRows,
  monthRows,
  activeWeek,
  activeMonth,
}: {
  locale: Locale;
  asOf: string;
  weekRows: readonly CapsuleRankRow[];
  monthRows: readonly CapsuleRankRow[];
  activeWeek: string;
  activeMonth: string;
}): AnswerCapsuleContent {
  const c = copy[locale];
  const weekLead = weekRows[0] ? fill(c.pulseWeekLead, rankValues(weekRows[0], locale, { period: activeWeek, metric: "gained" })) : c.pulseWeekFallback;
  const monthLead = monthRows[0] ? fill(c.pulseMonthLead, rankValues(monthRows[0], locale, { period: activeMonth, metric: "gained" })) : c.pulseMonthFallback;
  return capsule(locale, fill(c.pulseCapsule, { asOf, weekLead, monthLead }), asOf);
}

export function buildLocalizedPulseFaqs(locale: Locale, input: PulseFaqInput): FaqItem[] {
  const c = copy[locale];
  const weekLead = input.weekRows[0];
  const monthLead = input.monthRows[0];
  return [
    {
      question: c.pulseShowQ,
      answer: input.asOf ? fill(c.pulseShowAWithAsOf, { asOf: input.asOf }) : c.pulseShowANoAsOf,
    },
    {
      question: fill(c.pulseWeekQ, { period: input.activeWeek }),
      answer: weekLead
        ? fill(c.pulseWeekA, rankValues(weekLead, locale, { period: input.activeWeek, metric: "gained" }))
        : fill(c.pulseWeekFallbackA, { period: input.activeWeek }),
    },
    {
      question: fill(c.pulseMonthQ, { period: input.activeMonth }),
      answer: monthLead
        ? fill(c.pulseMonthA, rankValues(monthLead, locale, { period: input.activeMonth, metric: "gained" }))
        : fill(c.pulseMonthFallbackA, { period: input.activeMonth }),
    },
    { question: c.pulseDataQ, answer: c.pulseDataA },
  ];
}

export function buildLocalizedAllTimeRankingCapsule({
  locale,
  asOf,
  repoRows,
  orgRows,
}: {
  locale: Locale;
  asOf: string;
  repoRows: readonly CapsuleRankRow[];
  orgRows: readonly CapsuleOrgRankRow[];
}): AnswerCapsuleContent {
  const c = copy[locale];
  const repoLead = repoRows[0] ? fill(c.rankingsRepoLead, rankValues(repoRows[0], locale, { metric: "total" })) : c.rankingsRepoFallback;
  const orgLead = orgRows[0] ? fill(c.rankingsOrgLead, orgValues(orgRows[0], locale)) : c.rankingsOrgFallback;
  return capsule(locale, fill(c.rankingsCapsule, { asOf, repoLead, orgLead }), asOf);
}

export function buildLocalizedAllTimeRankingFaqs(locale: Locale, input: RankingsFaqInput): FaqItem[] {
  const c = copy[locale];
  const repoLead = input.repoRows[0];
  const orgLead = input.orgRows[0];
  return [
    {
      question: c.rankingsShowQ,
      answer: input.asOf ? fill(c.rankingsShowAWithAsOf, { asOf: input.asOf }) : c.rankingsShowANoAsOf,
    },
    {
      question: c.rankingsRepoQ,
      answer: repoLead ? fill(c.rankingsRepoA, rankValues(repoLead, locale, { metric: "total" })) : c.rankingsRepoFallbackA,
    },
    {
      question: c.rankingsOrgQ,
      answer: orgLead ? fill(c.rankingsOrgA, orgValues(orgLead, locale)) : c.rankingsOrgFallbackA,
    },
    { question: c.rankingsDataQ, answer: c.rankingsDataA },
  ];
}

export function buildLocalizedCompareCapsule(locale: Locale, asOf: string): AnswerCapsuleContent {
  return capsule(locale, fill(copy[locale].compareCapsule, { asOf }), asOf);
}

export function buildLocalizedCompareFaqs(locale: Locale, asOf: string | null): FaqItem[] {
  const c = copy[locale];
  return [
    {
      question: c.compareWhatQ,
      answer: asOf ? fill(c.compareWhatAWithAsOf, { asOf }) : c.compareWhatANoAsOf,
    },
    { question: c.compareReposQ, answer: c.compareReposA },
    { question: c.compareModesQ, answer: c.compareModesA },
    { question: c.compareQueryQ, answer: c.compareQueryA },
  ];
}

function capsule(locale: Locale, text: string, asOf: string): AnswerCapsuleContent {
  return { text: `${text}${copy[locale].sourceSuffix}`, asOf, source: ANSWER_CAPSULE_SOURCE };
}

function orgValues(row: CapsuleOrgRankRow, locale: Locale): Record<string, string> {
  return {
    org: row.login,
    value: fmtStars(row.current_stars_sum, locale),
    repos: formatInteger(locale, row.repo_count),
  };
}
