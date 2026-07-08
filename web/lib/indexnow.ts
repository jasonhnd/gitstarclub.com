import type { ZodType } from "zod";
import { CategoriesLookup, Meta, OrgEntity, OrgsLookup, RankList, RepoEntity, ReposLookup } from "@/lib/contracts";
import { currentUtcPeriods } from "@/lib/periods";
import { absoluteCanonicalUrl, buildSitemapPaths, publishedRankingPeriodPaths, siteBaseUrl } from "@/lib/sitemap";

export const INDEXNOW_KEY = "3a620d7fc7e043aa854c68841375d81b";
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_MAX_URLS_PER_BATCH = 100;
export const INDEXNOW_MAX_URLS_PER_RUN = 200;
export const INDEXNOW_MAX_ENTITY_DIFF_CANDIDATES = 200;
const INDEXNOW_TIMEOUT_MS = 5000;

type Fetcher = typeof fetch;
type IndexNowContext = { source: string; runId?: string; job?: string };
type VersionedReader = <T>(version: string, rel: string, schema: ZodType<T>) => Promise<T | null>;

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

export type IndexNowSubmitResult = {
  attempted: number;
  submitted: number;
  failed: number;
  urls: number;
  batches: number;
  truncated: boolean;
  skipped?: "disabled" | "empty";
};

type BatchOptions = {
  base?: string;
  maxUrls?: number;
  maxBatchSize?: number;
};

type SubmitOptions = BatchOptions & {
  endpoint?: string;
  enabled?: boolean;
  fetcher?: Fetcher;
};

export function indexNowKeyLocation(base = siteBaseUrl()): string {
  return absoluteCanonicalUrl(INDEXNOW_KEY_PATH, base);
}

export function isIndexNowEnabled(base = siteBaseUrl()): boolean {
  const explicit = process.env.INDEXNOW_ENABLED;
  if (explicit === "1") return true;
  if (explicit === "0") return false;

  const host = new URL(base).hostname;
  return process.env.VERCEL_ENV === "production" && (host === "gitstarclub.com" || host === "www.gitstarclub.com");
}

export function buildIndexNowPayloads(urlsOrPaths: string[], opts: BatchOptions = {}): { payloads: IndexNowPayload[]; truncated: boolean } {
  const base = opts.base ?? siteBaseUrl();
  const origin = new URL(base).origin;
  const maxUrls = opts.maxUrls ?? INDEXNOW_MAX_URLS_PER_RUN;
  const maxBatchSize = opts.maxBatchSize ?? INDEXNOW_MAX_URLS_PER_BATCH;
  const canonical = orderedCanonicalUrls(urlsOrPaths, origin);
  const capped = canonical.slice(0, maxUrls);
  const payloads: IndexNowPayload[] = [];

  for (let i = 0; i < capped.length; i += maxBatchSize) {
    payloads.push({
      host: new URL(origin).hostname,
      key: INDEXNOW_KEY,
      keyLocation: indexNowKeyLocation(origin),
      urlList: capped.slice(i, i + maxBatchSize),
    });
  }

  return { payloads, truncated: canonical.length > capped.length };
}

export async function submitIndexNowUrls(urlsOrPaths: string[], context: IndexNowContext, opts: SubmitOptions = {}): Promise<IndexNowSubmitResult> {
  const base = opts.base ?? siteBaseUrl();
  const enabled = opts.enabled ?? isIndexNowEnabled(base);
  const { payloads, truncated } = buildIndexNowPayloads(urlsOrPaths, opts);
  const urls = payloads.reduce((sum, payload) => sum + payload.urlList.length, 0);

  if (urls === 0) return { attempted: 0, submitted: 0, failed: 0, urls: 0, batches: 0, truncated, skipped: "empty" };
  if (!enabled) return { attempted: 0, submitted: 0, failed: 0, urls, batches: payloads.length, truncated, skipped: "disabled" };

  let submitted = 0;
  let failed = 0;
  const fetcher = opts.fetcher ?? fetch;

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INDEXNOW_TIMEOUT_MS);

    try {
      const res = await fetcher(opts.endpoint ?? INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (res.ok) {
        submitted += payload.urlList.length;
      } else {
        failed += payload.urlList.length;
        warnIndexNow("POST failed", context, { batch: i + 1, batches: payloads.length, status: res.status, urls: payload.urlList.length });
      }
    } catch (error) {
      failed += payload.urlList.length;
      warnIndexNow("POST threw", context, { batch: i + 1, batches: payloads.length, error: errorMessage(error), urls: payload.urlList.length });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { attempted: urls, submitted, failed, urls, batches: payloads.length, truncated };
}

export async function submitWorkflowPublishIndexNow(args: {
  runId: string;
  prevVersion: string | null;
  publishedAt: string;
}): Promise<IndexNowSubmitResult | null> {
  try {
    const paths = await workflowPublishCanonicalPaths(args);
    return await submitIndexNowUrls(paths, { source: "workflow-publish", runId: args.runId });
  } catch (error) {
    warnIndexNow("workflow publish derivation failed", { source: "workflow-publish", runId: args.runId }, { error: errorMessage(error) });
    return null;
  }
}

export async function submitLiveOverlayIndexNow(args: {
  job: string;
  day: string;
  year: number;
  monthPeriod: string;
  weekPeriod: string;
  repos: ReposLookup;
  repoIds: Iterable<number>;
  orgLogins: Iterable<string>;
}): Promise<IndexNowSubmitResult | null> {
  try {
    const paths = liveOverlayCanonicalPaths(args);
    return await submitIndexNowUrls(paths, { source: "cron-live-overlay", job: args.job, runId: args.day });
  } catch (error) {
    warnIndexNow("live overlay derivation failed", { source: "cron-live-overlay", job: args.job, runId: args.day }, { error: errorMessage(error) });
    return null;
  }
}

export async function workflowPublishCanonicalPaths(args: {
  runId: string;
  prevVersion: string | null;
  publishedAt: string;
  reader?: VersionedReader;
}): Promise<string[]> {
  const now = new Date(args.publishedAt);
  const read = args.reader ?? readVersioned;
  const [repos, orgs, categories, meta, prevRepos, prevOrgs, prevCategories, prevMeta] = await Promise.all([
    read(args.runId, "lookup/repos.json", ReposLookup),
    read(args.runId, "lookup/orgs.json", OrgsLookup),
    read(args.runId, "lookup/categories.json", CategoriesLookup),
    read(args.runId, "meta.json", Meta),
    args.prevVersion ? read(args.prevVersion, "lookup/repos.json", ReposLookup) : Promise.resolve(null),
    args.prevVersion ? read(args.prevVersion, "lookup/orgs.json", OrgsLookup) : Promise.resolve(null),
    args.prevVersion ? read(args.prevVersion, "lookup/categories.json", CategoriesLookup) : Promise.resolve(null),
    args.prevVersion ? read(args.prevVersion, "meta.json", Meta) : Promise.resolve(null),
  ]);

  const paths: string[] = [];
  const repoIds = new Set<number>(changedRepoIds(repos, prevRepos));
  const orgLogins = new Set<string>(changedOrgLogins(orgs, prevOrgs));

  if (!stableEqual(meta, prevMeta)) {
    paths.push("", "/pulse", "/rankings", ...periodPaths(meta, now));
  }

  if (categories && !stableEqual(categories, prevCategories)) {
    paths.push(...categorySitemapPaths(categories, now));
  }

  const rankPaths = rankCandidateViewPaths(meta, now);
  await Promise.all(
    rankPaths.map(async (rel) => {
      const [next, prev] = await Promise.all([
        read(args.runId, rel, RankList),
        args.prevVersion ? read(args.prevVersion, rel, RankList) : Promise.resolve(null),
      ]);
      if (stableEqual(next, prev)) return;

      const ranking = rankingCanonicalPath(rel);
      if (ranking) paths.push(ranking);
      for (const id of rankRepoIds(next, prev)) repoIds.add(id);
      for (const login of rankOrgLogins(next, prev)) orgLogins.add(login);
    }),
  );

  paths.push(
    ...(await changedRepoEntityPaths(args.runId, args.prevVersion, repos, repoIds, read)),
    ...(await changedOrgEntityPaths(args.runId, args.prevVersion, orgs, orgLogins, read)),
  );

  return orderedPaths(paths);
}

export function liveOverlayCanonicalPaths(args: {
  year: number;
  monthPeriod: string;
  weekPeriod: string;
  repos: ReposLookup;
  repoIds: Iterable<number>;
  orgLogins: Iterable<string>;
}): string[] {
  const month = Number(args.monthPeriod.slice(5, 7));
  const weekMatch = /^(\d{4})-W(\d{2})$/.exec(args.weekPeriod);
  const paths = ["", "/pulse", "/rankings", `/rankings/${args.year}`, `/rankings/${args.year}/${month}`];
  if (weekMatch) paths.push(`/rankings/${weekMatch[1]}/W${weekMatch[2]}`);

  for (const id of [...args.repoIds].sort((a, b) => a - b)) {
    const repo = args.repos[String(id)];
    if (repo) paths.push(`/${repo.full_name}`);
  }
  for (const login of [...args.orgLogins].sort((a, b) => a.localeCompare(b))) paths.push(`/o/${login}`);

  return orderedPaths(paths);
}

async function changedRepoEntityPaths(
  runId: string,
  prevVersion: string | null,
  repos: ReposLookup | null,
  repoIds: Set<number>,
  read: VersionedReader,
): Promise<string[]> {
  if (!repos) return [];
  const ids = [...repoIds].sort((a, b) => a - b).slice(0, INDEXNOW_MAX_ENTITY_DIFF_CANDIDATES);
  const changed = await Promise.all(
    ids.map(async (id) => {
      const repo = repos[String(id)];
      if (!repo) return null;
      if (!prevVersion) return `/${repo.full_name}`;
      const [next, prev] = await Promise.all([
        read(runId, `entity/repo/${id}.json`, RepoEntity),
        read(prevVersion, `entity/repo/${id}.json`, RepoEntity),
      ]);
      return stableEqual(next, prev) ? null : `/${repo.full_name}`;
    }),
  );
  return changed.filter((path): path is string => !!path);
}

async function changedOrgEntityPaths(
  runId: string,
  prevVersion: string | null,
  orgs: OrgsLookup | null,
  logins: Set<string>,
  read: VersionedReader,
): Promise<string[]> {
  if (!orgs) return [];
  const sorted = [...logins].sort((a, b) => a.localeCompare(b)).slice(0, INDEXNOW_MAX_ENTITY_DIFF_CANDIDATES);
  const changed = await Promise.all(
    sorted.map(async (login) => {
      if (!orgs[login]) return null;
      if (!prevVersion) return `/o/${login}`;
      const [next, prev] = await Promise.all([
        read(runId, `entity/org/${login}.json`, OrgEntity),
        read(prevVersion, `entity/org/${login}.json`, OrgEntity),
      ]);
      return stableEqual(next, prev) ? null : `/o/${login}`;
    }),
  );
  return changed.filter((path): path is string => !!path);
}

function rankCandidateViewPaths(meta: Meta | null, now: Date): string[] {
  const periods = new Set(periodIds(meta, now));
  const out = ["rank/all-time/repo/stock.json", "rank/all-time/org/stock.json"];
  for (const period of periods) {
    if (/^\d{4}$/.test(period)) {
      out.push(`rank/year/${period}/repo/flow.json`, `rank/year/${period}/repo/stock.json`, `rank/year/${period}/repo/growth.json`, `rank/year/${period}/repo/new.json`);
      out.push(`rank/year/${period}/org/flow.json`, `rank/year/${period}/org/stock.json`);
    } else if (/^\d{4}-\d{2}$/.test(period)) {
      out.push(`rank/month/${period}/repo/flow.json`, `rank/month/${period}/repo/stock.json`, `rank/month/${period}/repo/growth.json`, `rank/month/${period}/repo/new.json`);
      out.push(`rank/month/${period}/org/flow.json`, `rank/month/${period}/org/stock.json`);
    } else if (/^\d{4}-W\d{2}$/.test(period)) {
      out.push(`rank/week/${period}/repo/flow.json`, `rank/week/${period}/repo/stock.json`);
      out.push(`rank/week/${period}/org/flow.json`, `rank/week/${period}/org/stock.json`);
    }
  }
  return orderedPaths(out);
}

function periodPaths(meta: Meta | null, now: Date): string[] {
  return publishedRankingPeriodPaths(meta, now);
}

function periodIds(meta: Meta | null, now: Date): string[] {
  const current = currentUtcPeriods(now);
  const foldedMonth = meta?.folded_through?.month;
  const foldedWeek = meta?.folded_through?.week;
  const hasFoldedBounds = !!foldedMonth || !!foldedWeek;
  const ids = new Set<string>();

  if (!hasFoldedBounds) {
    ids.add(String(current.year));
    ids.add(current.monthPeriod);
    ids.add(current.weekPeriod);
    return [...ids].sort();
  }

  if (foldedMonth && /^\d{4}-\d{2}$/.test(foldedMonth)) {
    ids.add(foldedMonth.slice(0, 4));
    ids.add(foldedMonth);
  }
  if (foldedWeek && /^\d{4}-W\d{2}$/.test(foldedWeek)) {
    ids.add(foldedWeek.slice(0, 4));
    ids.add(foldedWeek);
  }
  if (ids.size === 0) ids.add(String(current.year));
  return [...ids].sort();
}

function rankingCanonicalPath(rel: string): string | null {
  if (rel.startsWith("rank/all-time/")) return "/rankings";

  const match = /^rank\/(year|month|week)\/([^/]+)\//.exec(rel);
  if (!match) return null;
  const [, window, period] = match;
  if (window === "year") return `/rankings/${period}`;
  if (window === "month") return `/rankings/${period.slice(0, 4)}/${Number(period.slice(5, 7))}`;
  const week = /^(\d{4})-W(\d{2})$/.exec(period);
  return week ? `/rankings/${week[1]}/W${week[2]}` : null;
}

function categorySitemapPaths(categories: CategoriesLookup, now: Date): string[] {
  return buildSitemapPaths({ categories, now })
    .filter((path) => path === "/categories" || path.startsWith("/categories/"))
    .filter((path) => !path.includes("/page/"));
}

function rankRepoIds(...lists: Array<RankList | null>): number[] {
  return lists.flatMap((list) => list?.items.map((item) => item.id).filter((id): id is number => id != null) ?? []);
}

function rankOrgLogins(...lists: Array<RankList | null>): string[] {
  return lists.flatMap((list) => list?.items.map((item) => item.login).filter((login): login is string => !!login) ?? []);
}

function changedRepoIds(next: ReposLookup | null, prev: ReposLookup | null): number[] {
  if (!next) return [];
  if (!prev) return Object.keys(next).map(Number);
  return Object.keys(next)
    .filter((id) => !stableEqual(next[id], prev[id]))
    .map(Number)
    .filter(Number.isFinite);
}

function changedOrgLogins(next: OrgsLookup | null, prev: OrgsLookup | null): string[] {
  if (!next) return [];
  if (!prev) return Object.keys(next);
  return Object.keys(next).filter((login) => !stableEqual(next[login], prev[login]));
}

async function readVersioned<T>(version: string, rel: string, schema: ZodType<T>): Promise<T | null> {
  const { readView } = await import("@/lib/data/source");
  return readView(`views/${version}/${rel}`, schema, { bust: version });
}

function orderedCanonicalUrls(values: string[], origin: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const value of values) {
    const url = canonicalizeUrl(value, origin);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls.sort((a, b) => urlPriority(a) - urlPriority(b) || a.localeCompare(b));
}

function canonicalizeUrl(value: string, origin: string): string | null {
  const raw = value.startsWith("http://") || value.startsWith("https://") ? value : absoluteCanonicalUrl(value, origin);
  try {
    const url = new URL(raw);
    if (url.origin !== origin) return null;
    url.hash = "";
    url.search = "";
    return url.pathname === "/" ? url.origin : `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function urlPriority(value: string): number {
  const path = new URL(value).pathname;
  if (path === "/") return 0;
  if (path === "/pulse") return 1;
  if (path === "/rankings") return 2;
  if (path.startsWith("/rankings/")) return 3;
  if (path.startsWith("/o/")) return 4;
  if (path.startsWith("/categories")) return 5;
  return 4;
}

function orderedPaths(paths: Iterable<string>): string[] {
  return [...new Set([...paths])].sort((a, b) => a.localeCompare(b));
}

function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(",")}}`;
}

function warnIndexNow(message: string, context: IndexNowContext, details: Record<string, unknown>): void {
  console.warn("[indexnow]", message, { ...context, ...details });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
