import type { Meta } from "@/lib/contracts";
import { intlLocaleTag, monthYearLabel } from "@/lib/format";

export const ANSWER_CAPSULE_SOURCE = "GitStarClub";

export type AnswerCapsuleContent = {
  text: string;
  asOf: string;
  source: typeof ANSWER_CAPSULE_SOURCE;
};

export type VisibleCapsuleLabels = {
  answerCapsule: string;
  dataAsOf: string;
  source: string;
};

export type CapsuleRankRow = {
  owner: string;
  name: string;
  gained?: number;
  total?: number;
};

export type CapsuleOrgRankRow = {
  login: string;
  current_stars_sum: number;
  repo_count: number;
};

type DataAsOfCandidate = string | null | undefined;
type DataAsOfOptions = { locale?: string };
type DataAsOfArg = DataAsOfCandidate | DataAsOfOptions;

export function formatDataAsOf(value: string | null | undefined, locale = "en"): string | null {
  if (!value) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (date) {
    return formatUtcDate(Number(date[1]), Number(date[2]), Number(date[3]), locale);
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    return monthYearLabel(locale, Number(month[1]), Number(month[2]));
  }
  const week = /^(\d{4})-W(\d{2})$/.exec(value);
  if (week) {
    return `${week[1]} week ${Number(week[2])}`;
  }
  if (/^\d{4}$/.test(value)) return value;
  return null;
}

export function dataAsOfLabel(...args: DataAsOfArg[]): string {
  const { candidates, locale } = dataAsOfArgs(args);
  const label = resolveDataAsOfLabel(...candidates, { locale });
  if (label) return label;
  throw new Error("GEO answer capsule requires a real data-as-of date from precomputed metadata.");
}

export function resolveDataAsOfLabel(...args: DataAsOfArg[]): string | null {
  const { candidates, locale } = dataAsOfArgs(args);
  for (const candidate of candidates) {
    const label = formatDataAsOf(candidate, locale);
    if (label) return label;
  }
  return null;
}

export function resolveDataAsOfValue(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && formatDataAsOf(candidate)) return candidate;
  }
  return null;
}

export function dataAsOfFromMeta(meta: Meta | null | undefined, ...args: DataAsOfArg[]): string {
  const { candidates: fallbacks, locale } = dataAsOfArgs(args);
  return dataAsOfLabel(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, ...fallbacks, { locale });
}

export function resolveDataAsOfFromMeta(meta: Meta | null | undefined, ...args: DataAsOfArg[]): string | null {
  const { candidates: fallbacks, locale } = dataAsOfArgs(args);
  return resolveDataAsOfLabel(meta?.generated_at, meta?.backfilled_at, meta?.folded_through?.month, ...fallbacks, { locale });
}

export function capsuleWordCount(capsule: Pick<AnswerCapsuleContent, "text"> | string): number {
  const text = typeof capsule === "string" ? capsule : capsule.text;
  return text.replace(/[—/]/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

export function visibleCapsuleSnapshot(capsule: AnswerCapsuleContent, labels: VisibleCapsuleLabels): string {
  return [labels.answerCapsule, capsule.text, `${labels.dataAsOf}: ${capsule.asOf}`, `${labels.source}: ${capsule.source}`].join("\n");
}

function formatUtcDate(year: number, month: number, day: number, locale: string): string {
  return new Intl.DateTimeFormat(intlLocaleTag(locale), { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(Date.UTC(year, month - 1, day));
}

function dataAsOfArgs(args: DataAsOfArg[]): { candidates: DataAsOfCandidate[]; locale: string } {
  const last = args.at(-1);
  if (isDataAsOfOptions(last)) {
    return { candidates: args.slice(0, -1) as DataAsOfCandidate[], locale: last.locale ?? "en" };
  }
  return { candidates: args as DataAsOfCandidate[], locale: "en" };
}

function isDataAsOfOptions(value: DataAsOfArg | undefined): value is DataAsOfOptions {
  return Boolean(value && typeof value === "object" && "locale" in value);
}
