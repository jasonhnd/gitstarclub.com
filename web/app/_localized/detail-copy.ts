import type { AnswerCapsuleLabels } from "@/app/_explore/AnswerCapsule";
import type { CategorySummaryTableLabels } from "@/app/_explore/SemanticDataTable";
import type { ShareableSnippetLabels } from "@/app/_explore/ShareableSnippet";
import { ANSWER_CAPSULE_SOURCE, type AnswerCapsuleContent, type CapsuleRankRow } from "@/lib/geo-capsules";
import { formatInteger } from "@/lib/format";
import { DETAIL_TEXT } from "./detail-copy/tables";
import type { DetailText } from "./detail-copy/types";
import { fill, listLabels, rankValues as formattedRankValues, repoName } from "./detail-copy/format";
export { fill } from "./detail-copy/format";
import type { CategoryDimensionRegistry, CategoryRegistry, CategoryRegistryEntry } from "@/lib/contracts";
import type { Dict, Locale } from "@/lib/i18n";
import type { FaqItem } from "@/lib/jsonld";

type RankingMetric = "gained" | "total";

export function detailText(locale: Locale): DetailText {
  return DETAIL_TEXT[locale];
}

export function answerCapsuleLabels(locale: Locale, t: Dict): AnswerCapsuleLabels {
  return {
    ariaLabel: t.common.answerCapsule,
    eyebrow: t.common.answerCapsule,
    dataAsOf: t.common.dataAsOf,
    source: t.common.source,
  };
}

export function categoryTableLabels(locale: Locale, t: Dict): CategorySummaryTableLabels {
  return {
    caption: t.categories.title,
    category: t.categories.eyebrow,
    dimension: t.categories.dimensionEyebrow,
    slug: t.tables.slug,
    trackedRepositories: t.categories.trackedRepositories,
    gitstarclubUrl: t.tables.gitstarclubUrl,
    pendingCount: t.categories.pendingCount,
  };
}

export function shareButtonLabels(locale: Locale, t: Dict) {
  return {
    label: t.share.label,
    copied: t.share.copied,
    onX: t.share.onX,
    opensNewTab: t.share.opensNewTab,
  };
}

export function shareableSnippetLabels(t: Dict): ShareableSnippetLabels {
  return {
    eyebrow: t.share.snippet,
    copy: t.share.copy,
    copied: t.share.copied,
    embed: t.share.embed,
    embedCopied: t.share.embedCopied,
  };
}

export function paginationLabels(t: Dict): { previous: string; next: string } {
  return { previous: t.common.previous, next: t.common.next };
}

export function buildLocalizedRankingCapsule({
  locale,
  title,
  asOf,
  rows,
  metric,
}: {
  locale: Locale;
  title: string;
  asOf: string;
  rows: readonly CapsuleRankRow[];
  metric: RankingMetric;
}): AnswerCapsuleContent {
  const text = detailText(locale);
  const [first, second, third] = rows;
  const leader = first ? fill(text.rankingLeader, rankValues(first, locale, metric)) : text.rankingEmpty;
  const followers = second && third ? fill(text.rankingFollowers, { second: repoName(second), third: repoName(third) }) : "";
  return capsule(locale, fill(text.rankingCapsule, { asOf, title, metric: rankingMetricLabel(locale, metric), leader, followers }), asOf);
}

export function buildLocalizedRankingFaqs({
  locale,
  title,
  asOf,
  rows,
  metric,
}: {
  locale: Locale;
  title: string;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
  metric: RankingMetric;
}): FaqItem[] {
  const text = detailText(locale);
  const leader = rows[0];
  const second = rows[1];
  return [
    {
      question: fill(text.rankingWhatQ, { title }),
      answer: asOf
        ? fill(text.rankingWhatAWithAsOf, { asOf, title, metric: rankingMetricLabel(locale, metric) })
        : fill(text.rankingWhatANoAsOf, { title, metric: rankingMetricLabel(locale, metric) }),
    },
    {
      question: fill(text.rankingLeaderQ, { title }),
      answer: leader ? fill(text.rankingLeaderA, { title, ...rankValues(leader, locale, metric) }) : fill(text.rankingLeaderFallbackA, { title }),
    },
    {
      question: second
        ? fill(text.rankingRunnerQ, { title, repo: repoName(leader ?? second) })
        : fill(text.rankingRunnerFallbackQ, { title }),
      answer: second ? fill(text.rankingRunnerA, rankValues(second, locale, metric)) : text.rankingRunnerFallbackA,
    },
    {
      question: fill(text.rankingDataQ, { title }),
      answer: fill(text.rankingDataA, { title }),
    },
  ];
}

export function buildLocalizedCategoryIndexCapsule(locale: Locale, registry: CategoryRegistry, asOf: string): AnswerCapsuleContent {
  const text = detailText(locale);
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const labels = listLabels(
    registry.dimensions.slice(0, 3).map((dimension) => dimension.label),
    locale,
  );
  return capsule(
    locale,
    fill(text.categoryIndexCapsule, {
      asOf,
      categories: count(locale, publicCategories.length),
      dimensions: count(locale, registry.dimensions.length),
      labels,
    }),
    asOf,
  );
}

export function buildLocalizedCategoryIndexFaqs(locale: Locale, registry: CategoryRegistry, asOf: string | null): FaqItem[] {
  const text = detailText(locale);
  const publicCategories = registry.dimensions.flatMap((dimension) => dimension.categories.filter((category) => category.public));
  const firstDimension = registry.dimensions[0];
  const values = {
    categories: count(locale, publicCategories.length),
    dimensions: count(locale, registry.dimensions.length),
    labels: listLabels(registry.dimensions.map((dimension) => dimension.label), locale),
  };
  return [
    {
      question: text.categoryIndexQ,
      answer: asOf ? fill(text.categoryIndexAWithAsOf, { asOf, ...values }) : fill(text.categoryIndexANoAsOf, values),
    },
    { question: text.categoryDimensionsQ, answer: fill(text.categoryDimensionsA, values) },
    { question: text.categoryCountsQ, answer: text.categoryCountsA },
    {
      question: text.categoryMoveQ,
      answer: firstDimension ? fill(text.categoryMoveAWithDimension, { label: firstDimension.label }) : text.categoryMoveAFallback,
    },
  ];
}

export function buildLocalizedCategoryDimensionCapsule(locale: Locale, dimension: CategoryDimensionRegistry, asOf: string): AnswerCapsuleContent {
  const text = detailText(locale);
  const publicCategories = dimension.categories.filter((category) => category.public);
  return capsule(
    locale,
    fill(text.categoryDimensionCapsule, {
      asOf,
      label: dimension.label,
      categories: count(locale, publicCategories.length),
    }),
    asOf,
  );
}

export function buildLocalizedCategoryDimensionFaqs(locale: Locale, dimension: CategoryDimensionRegistry, asOf: string | null): FaqItem[] {
  const text = detailText(locale);
  const publicCategories = dimension.categories.filter((category) => category.public);
  const largest = [...publicCategories].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
  const values = { label: dimension.label, categories: count(locale, publicCategories.length) };
  return [
    {
      question: fill(text.categoryDimensionQ, { label: dimension.label }),
      answer: asOf ? fill(text.categoryDimensionAWithAsOf, { asOf, ...values }) : fill(text.categoryDimensionANoAsOf, values),
    },
    {
      question: fill(text.categoryLargestQ, { label: dimension.label }),
      answer: largest
        ? fill(text.categoryLargestA, { label: dimension.label, category: largest.label, count: count(locale, largest.count) })
        : fill(text.categoryLargestFallbackA, { label: dimension.label }),
    },
    {
      question: fill(text.categoryLinksQ, { label: dimension.label }),
      answer: fill(text.categoryLinksA, { label: dimension.label }),
    },
    {
      question: fill(text.categoryNoClientQ, { label: dimension.label }),
      answer: fill(text.categoryNoClientA, { label: dimension.label }),
    },
  ];
}

export function buildLocalizedCategoryDetailCapsule({
  locale,
  category,
  asOf,
  rows,
}: {
  locale: Locale;
  category: CategoryRegistryEntry;
  asOf: string;
  rows: readonly CapsuleRankRow[];
}): AnswerCapsuleContent {
  const text = detailText(locale);
  const [first, second, third] = rows;
  const leader = first ? fill(text.rankingLeader, rankValues(first, locale, "total")) : fill(text.categoryDetailLeaderFallbackA, { label: category.label });
  const followers = second && third ? fill(text.rankingFollowers, { second: repoName(second), third: repoName(third) }) : "";
  return capsule(
    locale,
    fill(text.categoryDetailCapsule, {
      asOf,
      label: category.label,
      count: count(locale, category.count),
      leader,
      followers,
    }),
    asOf,
  );
}

export function buildLocalizedCategoryDetailFaqs({
  locale,
  category,
  asOf,
  rows,
}: {
  locale: Locale;
  category: CategoryRegistryEntry;
  asOf: string | null;
  rows: readonly CapsuleRankRow[];
}): FaqItem[] {
  const text = detailText(locale);
  const leader = rows[0];
  const second = rows[1];
  return [
    {
      question: fill(text.categoryDetailQ, { label: category.label }),
      answer: asOf
        ? fill(text.categoryDetailAWithAsOf, { asOf, label: category.label, count: count(locale, category.count) })
        : fill(text.categoryDetailANoAsOf, { label: category.label, count: count(locale, category.count) }),
    },
    {
      question: fill(text.categoryDetailLeaderQ, { label: category.label }),
      answer: leader
        ? fill(text.categoryDetailLeaderA, { label: category.label, ...rankValues(leader, locale, "total") })
        : fill(text.categoryDetailLeaderFallbackA, { label: category.label }),
    },
    {
      question: second
        ? fill(text.categoryDetailRunnerQ, { label: category.label, repo: repoName(leader ?? second) })
        : fill(text.categoryDetailRunnerFallbackQ, { label: category.label }),
      answer: second
        ? fill(text.categoryDetailRunnerA, { label: category.label, ...rankValues(second, locale, "total") })
        : text.categoryDetailRunnerFallbackA,
    },
    {
      question: fill(text.categoryDetailDataQ, { label: category.label }),
      answer: text.categoryDetailDataA,
    },
  ];
}

function capsule(locale: Locale, text: string, asOf: string): AnswerCapsuleContent {
  return { text: `${text}${detailText(locale).sourceSuffix}`, asOf, source: ANSWER_CAPSULE_SOURCE };
}

function rankingMetricLabel(locale: Locale, metric: RankingMetric): string {
  const text = detailText(locale);
  return metric === "total" ? text.rankingMetricTotal : text.rankingMetricGained;
}

function rankValues(row: CapsuleRankRow, locale: Locale, metric: RankingMetric): Record<string, string> {
  const values = formattedRankValues(row, locale, { metric });
  const template = metric === "total" ? detailText(locale).totalStarsValue : detailText(locale).gainedStarsValue;
  return { ...values, value: fill(template, { value: values.value }) };
}

function count(locale: Locale, value: number): string {
  return formatInteger(locale, value);
}
