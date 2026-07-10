import { safeExternalHref } from "@/lib/external-url";

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export type RepoPageLanguage = { name: string; size?: number | null; color?: string | null };
export type RepoPageMilestones = {
  crossed_10k: string | null;
  crossed_50k: string | null;
  crossed_100k: string | null;
};
export type RepoPageEntity = {
  id: number;
  full_name: string;
  owner: string;
  owner_type: "User" | "Organization";
  name: string;
  description: string | null;
  language: string | null;
  languages: RepoPageLanguage[];
  topics: string[];
  homepage_url: string | null;
  license: string | null;
  latest_release: {
    name: string | null;
    tag_name: string;
    published_at: string | null;
    url: string | null;
  } | null;
  created_at: string | null;
  current_stars: number;
  is_archived: boolean;
  milestones: RepoPageMilestones;
  curve: {
    monthly: Array<[string, number, number]>;
    recent_daily: Array<[string, number]>;
  };
  monthly_table: Array<{ month: string; adds: number; rank: number | null }>;
  rank_history: { month?: Array<[string, number]> };
  inflections: Array<{ period: string; flow: number; kind: "surge" | "peak" }>;
};

export function normalizeRepoPageEntity(value: unknown, expectedId?: number): RepoPageEntity | null {
  if (!isRecord(value)) return null;

  const id = nonNegativeInteger(value.id);
  const fullName = nonEmptyString(value.full_name);
  const owner = nonEmptyString(value.owner);
  const name = nonEmptyString(value.name);
  const ownerType = value.owner_type === "User" || value.owner_type === "Organization" ? value.owner_type : null;
  const currentStars = nonNegativeInteger(value.current_stars);

  if (id === null || (expectedId !== undefined && id !== expectedId) || !fullName || !owner || !name || !ownerType || currentStars === null) {
    return null;
  }
  if (!isRenderableRepoFullName(fullName) || fullName.toLowerCase() !== `${owner}/${name}`.toLowerCase()) return null;

  const curve = isRecord(value.curve) ? value.curve : {};

  return {
    id,
    full_name: fullName,
    owner,
    owner_type: ownerType,
    name,
    description: optionalString(value.description),
    language: optionalString(value.language),
    languages: normalizeLanguages(value.languages),
    topics: normalizeStringArray(value.topics),
    homepage_url: safeExternalHref(optionalString(value.homepage_url)),
    license: optionalString(value.license),
    latest_release: normalizeLatestRelease(value.latest_release),
    created_at: validDateString(value.created_at),
    current_stars: currentStars,
    is_archived: typeof value.is_archived === "boolean" ? value.is_archived : false,
    milestones: normalizeMilestones(value.milestones),
    curve: {
      monthly: normalizeMonthlyPoints(curve.monthly),
      recent_daily: normalizeDailyPoints(curve.recent_daily),
    },
    monthly_table: normalizeMonthlyTable(value.monthly_table),
    rank_history: normalizeRankHistory(value.rank_history),
    inflections: normalizeInflections(value.inflections),
  };
}

export function isRenderableRepoFullName(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => part.trim().length > 0 && !part.includes("?") && !part.includes("#"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function validDateString(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function validPeriodString(value: unknown): string | null {
  return typeof value === "string" && PERIOD_RE.test(value) ? value : null;
}

function normalizeLanguages(value: unknown): RepoPageLanguage[] {
  if (!Array.isArray(value)) return [];
  const out: RepoPageLanguage[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = nonEmptyString(entry.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      size: nonNegativeInteger(entry.size),
      color: optionalString(entry.color),
    });
  }
  return out;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = nonEmptyString(entry);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function normalizeLatestRelease(value: unknown): RepoPageEntity["latest_release"] {
  if (!isRecord(value)) return null;
  const tagName = nonEmptyString(value.tag_name);
  if (!tagName) return null;
  return {
    name: optionalString(value.name),
    tag_name: tagName,
    published_at: validDateString(value.published_at),
    url: safeExternalHref(optionalString(value.url)),
  };
}

function normalizeMilestones(value: unknown): RepoPageMilestones {
  const source = isRecord(value) ? value : {};
  return {
    crossed_10k: validDateString(source.crossed_10k),
    crossed_50k: validDateString(source.crossed_50k),
    crossed_100k: validDateString(source.crossed_100k),
  };
}

function normalizeMonthlyPoints(value: unknown): Array<[string, number, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    const period = validPeriodString(entry[0]);
    const adds = integer(entry[1]);
    const total = nonNegativeInteger(entry[2]);
    return period && adds !== null && total !== null ? ([[period, adds, total]] as Array<[string, number, number]>) : [];
  });
}

function normalizeDailyPoints(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    const date = validDateString(entry[0]);
    const adds = integer(entry[1]);
    return date && adds !== null ? ([[date, adds]] as Array<[string, number]>) : [];
  });
}

function normalizeMonthlyTable(value: unknown): RepoPageEntity["monthly_table"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const month = validPeriodString(entry.month);
    const adds = integer(entry.adds);
    const rank = entry.rank === null || entry.rank === undefined ? null : nonNegativeInteger(entry.rank);
    return month && adds !== null && (rank !== null || entry.rank === null || entry.rank === undefined) ? [{ month, adds, rank }] : [];
  });
}

function normalizeRankHistory(value: unknown): RepoPageEntity["rank_history"] {
  if (!isRecord(value)) return {};
  const month = normalizeRankPairs(value.month);
  return month.length > 0 ? { month } : {};
}

function normalizeRankPairs(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    const period = validPeriodString(entry[0]);
    const rank = nonNegativeInteger(entry[1]);
    return period && rank !== null ? ([[period, rank]] as Array<[string, number]>) : [];
  });
}

function normalizeInflections(value: unknown): RepoPageEntity["inflections"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const period = validPeriodString(entry.period);
    const flow = integer(entry.flow);
    const kind = entry.kind === "surge" || entry.kind === "peak" ? entry.kind : null;
    return period && flow !== null && kind ? [{ period, flow, kind }] : [];
  });
}
