import { FIRST_YEAR, isoWeek } from "./periods";

// Next.js decodes dynamic route segments once before passing params to handlers.
// These validators accept decoded values only. A remaining percent sign is
// invalid, including double-encoded input; never decode it a second time.
export function githubLogin(value: string): string | null {
  if (value.length < 1 || value.length > 39) return null;
  return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(value) ? value : null;
}

export function githubRepoName(value: string): string | null {
  if (value.length < 1 || value.length > 100 || value === "." || value === "..") return null;
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
}

export function githubRepoFullName(owner: string, name: string): string | null {
  return githubLogin(owner) && githubRepoName(name) ? `${owner}/${name}` : null;
}

export function isGithubRepoId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function rankingYear(value: string, now = new Date()): number | null {
  if (value.length !== 4 || !/^[0-9]{4}$/.test(value)) return null;
  const year = Number(value);
  // The next ISO week-year can start in late December.
  return year >= FIRST_YEAR && year <= now.getUTCFullYear() + 1 ? year : null;
}

export type RankingPeriod =
  | { window: "year"; year: number; period: string }
  | { window: "month"; year: number; month: number; period: string }
  | { window: "week"; year: number; week: number; period: string };

export function rankingRoutePeriod(yearValue: string, value?: string, now = new Date()): RankingPeriod | null {
  const year = rankingYear(yearValue, now);
  if (year === null) return null;
  if (value === undefined) return { window: "year", year, period: String(year) };
  if (value.length < 1 || value.length > 3) return null;
  const weekMatch = /^[Ww]([0-9]{1,2})$/.exec(value);
  if (weekMatch) {
    const week = Number(weekMatch[1]);
    const lastWeek = isoWeek(new Date(Date.UTC(year, 11, 28))).week;
    if (week < 1 || week > lastWeek) return null;
    return { window: "week", year, week, period: `${year}-W${String(week).padStart(2, "0")}` };
  }
  if (!/^[0-9]{1,2}$/.test(value)) return null;
  const month = Number(value);
  return month >= 1 && month <= 12
    ? { window: "month", year, month, period: `${year}-${String(month).padStart(2, "0")}` }
    : null;
}

/** Storage period identifiers must already have canonical syntax. */
export function isRankingPeriod(window: string, value: string): boolean {
  if (window === "all") return value === "all";
  if (window === "year") return rankingYear(value) !== null;
  if (value.length > 8) return false;
  const match = window === "month"
    ? /^([0-9]{4})-(0[1-9]|1[0-2])$/.exec(value)
    : window === "week" ? /^([0-9]{4})-(W[0-9]{2})$/.exec(value) : null;
  if (!match) return false;
  const parsed = rankingRoutePeriod(match[1], match[2]);
  return parsed?.window === window && parsed.period === value;
}
