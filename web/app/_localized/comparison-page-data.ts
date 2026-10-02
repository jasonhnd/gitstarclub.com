import { createElement, type ReactNode } from "react";
import { getRepoCurve } from "@/lib/data";
import type { Locale } from "@/lib/i18n";
import {
  COMMON_COMPARE_PAIRS,
  buildComparePairConclusion,
  type CompareConclusionLabels,
  type ComparePairConclusion,
  type ComparePairSpec,
} from "@/lib/compare/conclusions";

// Only optional example reads are isolated here. Required page reads and
// authoritative writes retain their own failure semantics.
export async function loadPairConclusions(repoIds: Map<string, number>, locale: Locale, labels: CompareConclusionLabels) {
  const results = await Promise.allSettled(
    COMMON_COMPARE_PAIRS.map(async (pair) => {
      const aId = repoIds.get(pair.a.toLowerCase());
      const bId = repoIds.get(pair.b.toLowerCase());
      if (aId === undefined || bId === undefined) return null;
      const [a, b] = await Promise.all([getRepoCurve(aId), getRepoCurve(bId)]);
      if (!a || !b) return null;
      return buildComparePairConclusion(pair, a, b, locale, labels);
    }),
  );
  const conclusions: ComparePairConclusion[] = [];
  const unavailablePairs: ComparePairSpec[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      if (result.value) conclusions.push(result.value);
    } else {
      const pair = COMMON_COMPARE_PAIRS[index];
      unavailablePairs.push(pair);
      console.warn("[compare] optional example pair unavailable", { pair: pair.label, error: result.reason });
    }
  });
  return { conclusions, unavailablePairs };
}

// This module is .ts so the shared server renderer uses React's element factory.
// Preserve the original definition-list markup, classes, and accessible labels.
export function HeroFacts({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return createElement(
    "dl",
    { className: "grid gap-3 rounded-lg border border-outline-variant bg-surface-container px-4 py-4" },
    items.map((item) => createElement(
      "div",
      { key: item.label, className: "min-w-0" },
      createElement("dt", { className: "font-mono text-[0.68rem] uppercase tracking-wider text-on-surface-variant" }, item.label),
      createElement("dd", { className: "mt-1 break-words font-mono text-[0.95rem] font-extrabold text-on-surface" }, item.value),
    )),
  );
}
