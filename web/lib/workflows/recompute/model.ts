// Recompute model — in-memory view of canonical/v2 shards, the pure-JS replacement
// for the DuckDB tables in pipeline/backfill/05-precompute.mjs. Step drivers and the
// offline parity harness both build a Model and feed it to the compute functions.
// No I/O here: callers pass already-parsed shard records. See VERCEL-DATA-OPERATIONS §3/§6.

export type Period = string; // "YYYY-MM" | "YYYY-Www" | "YYYY"
export type DateStr = string; // "YYYY-MM-DD"
export type OwnerType = "User" | "Organization";

/** One repo dimension row (canonical/v2/repos/<bucket>.json value). */
export interface RepoMeta {
  id: number;
  owner: string;
  owner_type: OwnerType;
  name: string;
  full_name: string;
  description?: string | null;
  language?: string | null;
  topics?: string[];
  created_at?: string;
  current_stars: number;
  is_archived?: boolean;
  crossed_10k?: string | null;
  crossed_50k?: string | null;
  crossed_100k?: string | null;
  tracked_since?: string | null;
  /** Frozen discount d = current_stars@seam / cumgross@seam_date (bootstrap-fixed). */
  d: number;
}

export type Series = ReadonlyArray<readonly [Period, number]>; // [[period, flow], ...] period-asc
export type DailySeries = ReadonlyArray<readonly [DateStr, number]>; // [[date, delta], ...] date-asc

export interface OrgAgg {
  login: string;
  owner_type: OwnerType;
  repo_count: number;
  current_stars_sum: number;
  members: number[]; // member repo ids
}

export interface SeamPeriods {
  month: Period;
  week: Period;
}

export interface Model {
  repos: Map<number, RepoMeta>;
  monthly: Map<number, Series>;
  weekly: Map<number, Series>;
  recentDaily: Map<number, DailySeries>;
  siteDaily: DailySeries; // all years, date-asc
  orgs: Map<string, OrgAgg>; // login -> aggregate
  ids: number[]; // repo ids, ascending
  seam: SeamPeriods; // immutable gross/net boundary (periods ≤ seam are gross × d)
}

const numId = (k: string): number => Number(k);

/** Raw shard records as parsed from JSON (keyed by stringified repo id). */
export interface RawShards {
  repos: Record<string, RepoMeta>;
  monthly: Record<string, Series>;
  weekly: Record<string, Series>;
  recentDaily: Record<string, DailySeries>;
  siteDailyByYear: Record<string, { year: string; cells: DailySeries }>;
}

/** Merge bucket shards (already combined into flat records) into a compute Model.
 *  seamDate (canonical/v2/meta.seam_date) fixes the gross/net boundary for stock anchoring. */
export function buildModel(raw: RawShards, seamDate: DateStr): Model {
  const repos = new Map<number, RepoMeta>();
  for (const [k, v] of Object.entries(raw.repos)) repos.set(numId(k), v);

  const toSeriesMap = <T>(rec: Record<string, T>): Map<number, T> => {
    const m = new Map<number, T>();
    for (const [k, v] of Object.entries(rec)) m.set(numId(k), v);
    return m;
  };
  const monthly = toSeriesMap(raw.monthly);
  const weekly = toSeriesMap(raw.weekly);
  const recentDaily = toSeriesMap(raw.recentDaily);

  // site-daily: concat all year shards, sort by date.
  const siteCells: Array<readonly [DateStr, number]> = [];
  for (const { cells } of Object.values(raw.siteDailyByYear)) siteCells.push(...cells);
  siteCells.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  // org aggregate (mirror precompute exportLookups: sum current_stars over owner).
  const orgs = new Map<string, OrgAgg>();
  for (const r of repos.values()) {
    let o = orgs.get(r.owner);
    if (!o) {
      o = { login: r.owner, owner_type: r.owner_type, repo_count: 0, current_stars_sum: 0, members: [] };
      orgs.set(r.owner, o);
    }
    o.repo_count++;
    o.current_stars_sum += r.current_stars;
    o.members.push(r.id);
  }

  const ids = [...repos.keys()].sort((a, b) => a - b);
  return { repos, monthly, weekly, recentDaily, siteDaily: siteCells, orgs, ids, seam: seamPeriods(seamDate) };
}

/** ISO week / month / year period strings sort lexically in chronological order. */
export const byPeriod = (a: Period, b: Period): number => (a < b ? -1 : a > b ? 1 : 0);

function isoWeekStr(d: Date): Period {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Immutable gross/net boundary = the month/week containing the last gross day (seam_date − 1).
 *  Periods ≤ these are pre-seam gross (× d); later periods are post-seam net (RANKING §3, §8.3). */
export function seamPeriods(seamDate: DateStr): SeamPeriods {
  if (!seamDate) return { month: "9999-12", week: "9999-W99" }; // no seam → treat everything gross
  const dt = new Date(`${seamDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1); // last gross day
  return { month: dt.toISOString().slice(0, 7), week: isoWeekStr(dt) };
}
