import type { CompareCurve } from "@/lib/contracts";
import { fmtStars, monthYearLabel } from "@/lib/format";

export type ComparePairSpec = {
  label: string;
  a: string;
  b: string;
};

export const COMMON_COMPARE_PAIRS = [
  { label: "React vs Vue", a: "react/react", b: "vuejs/vue" },
  { label: "Next.js vs Nuxt", a: "vercel/next.js", b: "nuxt/nuxt" },
  { label: "React Native vs Flutter", a: "facebook/react-native", b: "flutter/flutter" },
] as const satisfies readonly ComparePairSpec[];

export type ComparePairRepoResult = {
  fullName: string;
  crossed10k: string;
  crossed10kLabel: string;
  originStars: number;
  starsAtHorizon: number;
  gainedAfter10k: number;
  currentStars: number;
};

export type ComparePairConclusion = {
  label: string;
  repos: [ComparePairRepoResult, ComparePairRepoResult];
  horizonMonths: number;
  horizonLabel: string;
  winner: ComparePairRepoResult | null;
  loser: ComparePairRepoResult | null;
  result: string;
};

export function buildComparePairConclusion(
  spec: ComparePairSpec,
  a: CompareCurve,
  b: CompareCurve,
): ComparePairConclusion | null {
  const aOrigin = aligned10kOrigin(a);
  const bOrigin = aligned10kOrigin(b);
  if (aOrigin === null || bOrigin === null) return null;

  const horizonMonths = Math.min(a.points.length - aOrigin, b.points.length - bOrigin) - 1;
  if (horizonMonths < 1) return null;

  const aResult = repoResultAtHorizon(a, aOrigin, horizonMonths);
  const bResult = repoResultAtHorizon(b, bOrigin, horizonMonths);
  const comparison = aResult.gainedAfter10k - bResult.gainedAfter10k;
  const winner = comparison === 0 ? null : comparison > 0 ? aResult : bResult;
  const loser = comparison === 0 ? null : comparison > 0 ? bResult : aResult;
  const horizonLabel = formatMonthSpan(horizonMonths);

  return {
    label: spec.label,
    repos: [aResult, bResult],
    horizonMonths,
    horizonLabel,
    winner,
    loser,
    result: winner && loser
      ? `${winner.fullName} grew faster after 10k, gaining ${formatCompareGain(winner.gainedAfter10k)} stars in ${horizonLabel} versus ${formatCompareGain(loser.gainedAfter10k)} for ${loser.fullName}.`
      : `Both repositories gained ${formatCompareGain(aResult.gainedAfter10k)} stars in ${horizonLabel} after 10k.`,
  };
}

export function buildCompareConclusionText(asOf: string, conclusions: readonly ComparePairConclusion[]): string | null {
  const featured = conclusions[0];
  if (!featured) return null;
  const source = "GitStarClub computes the table server-side from precomputed Blob repo-curve JSON; client-selected query pairs remain interactive only.";
  return `As of ${asOf}, ${featured.result} ${source}`;
}

export function formatCompareGain(value: number): string {
  const prefix = value >= 0 ? "+" : "-";
  return `${prefix}${fmtStars(Math.abs(value))}`;
}

function aligned10kOrigin(curve: CompareCurve): number | null {
  if (!curve.crossed_10k) return null;
  const crossedMonth = curve.crossed_10k.slice(0, 7);
  const index = curve.points.findIndex(([period]) => period >= crossedMonth);
  return index >= 0 ? index : null;
}

function repoResultAtHorizon(curve: CompareCurve, origin: number, horizonMonths: number): ComparePairRepoResult {
  const originStars = curve.points[origin][1];
  const starsAtHorizon = curve.points[origin + horizonMonths][1];
  return {
    fullName: curve.full_name,
    crossed10k: curve.crossed_10k ?? "",
    crossed10kLabel: monthLabel(curve.crossed_10k ?? ""),
    originStars,
    starsAtHorizon,
    gainedAfter10k: starsAtHorizon - originStars,
    currentStars: curve.current_stars,
  };
}

function monthLabel(value: string): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  return monthYearLabel("en", year, month);
}

function formatMonthSpan(months: number): string {
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years === 0) return `${months} ${months === 1 ? "month" : "months"}`;
  const yearPart = `${years} ${years === 1 ? "year" : "years"}`;
  if (remainingMonths === 0) return yearPart;
  return `${yearPart} ${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`;
}
