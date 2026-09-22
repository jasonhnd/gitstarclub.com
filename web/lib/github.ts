// GitHub client: GraphQL (daily cron star counts) + REST Search (whitelist) +
// GraphQL nodes() (metadata). Server-only; needs env GITHUB_TOKEN. See docs/OPS.md.
import { z } from "zod";
import {
  WhitelistEntry,
  type WhitelistEntry as WhitelistEntryRecord,
  type WhitelistSearchProgress,
} from "@/lib/contracts";
import { FetchTimeoutError, GITHUB_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import {
  getMinTrackedStars,
  requireGithubToken,
  WHITELIST_SEARCH_YIELD_SLACK_MS,
} from "@/lib/runtime-config";

const ENDPOINT = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const MAX_RETRIES = 4;
const BATCH_PAUSE_MS = 2000;

/** GitHub rejects Workers/edge clients that omit User-Agent (administrative 403). */
export const GITHUB_USER_AGENT = "gitstarclub";
export const GITHUB_ACCEPT = "application/vnd.github+json";

export function githubApiHeaders(
  token: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `bearer ${token}`,
    Accept: GITHUB_ACCEPT,
    "User-Agent": GITHUB_USER_AGENT,
    ...extra,
  };
}

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

export interface GitHubFetchOptions {
  timeoutMs?: number;
}

export class GitHubHttpError extends Error {
  readonly status: number;
  readonly source: "graphql" | "search";

  constructor(source: "graphql" | "search", status: number, body: string) {
    const label = source === "graphql" ? "GraphQL" : "Search";
    super(`GitHub ${label} ${status}: ${body.slice(0, 200)}`);
    this.name = "GitHubHttpError";
    this.status = status;
    this.source = source;
  }
}

export function isTransientGithubStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function isTransientGithubError(error: unknown): boolean {
  if (error instanceof GitHubHttpError) return isTransientGithubStatus(error.status);
  if (error instanceof FetchTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  if (/fetch timed out after/i.test(error.message)) return true;
  return /GitHub (?:GraphQL|Search) (429|5\d\d)\b/.test(error.message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NonNegativeInt = z.number().int().nonnegative();

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);

  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (remaining === 0 && Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 0) + 1000, 60_000);
  }

  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

function secondaryLimitDelayMs(status: number, text: string): number | null {
  if (status !== 403) return null;
  return /secondary rate limit|abuse detection|rate limit/i.test(text) ? 60_000 : null;
}

async function gql<T>(token: string, query: string, schema: z.ZodType<T>, attempt = 1, opts: GitHubFetchOptions = {}): Promise<T> {
  const res = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: githubApiHeaders(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({ query }),
    cache: "no-store",
    timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
  });
  const text = await res.text();
  if ((res.status === 403 || isTransientGithubStatus(res.status)) && attempt <= MAX_RETRIES) {
    await sleep(secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
    return gql<T>(token, query, schema, attempt + 1, opts);
  }
  if (!res.ok) throw new GitHubHttpError("graphql", res.status, text);
  const json = z.object({ data: z.unknown().optional(), errors: z.unknown().optional() }).passthrough().parse(JSON.parse(text));
  // Partial data + errors is normal (a deleted/renamed repo aliases to null); only fail with no data.
  if (!json.data) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? {}).slice(0, 200)}`);
  if (json.errors) console.warn("[github] GraphQL returned partial errors", JSON.stringify(json.errors).slice(0, 200));
  return schema.parse(json.data);
}

/** Current stargazerCount for each repo → Map<id, stars>. Missing/renamed repos are skipped. */
export async function fetchStarCounts(refs: RepoRef[], batchSize = 100, opts: GitHubFetchOptions = {}): Promise<Map<number, number>> {
  const token = requireGithubToken();
  const out = new Map<number, number>();
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    const query = `query{${batch
      .map((r, j) => `r${j}: repository(owner:${JSON.stringify(r.owner)}, name:${JSON.stringify(r.name)}){stargazerCount}`)
      .join(" ")}}`;
    const data = await gql(token, query, z.record(z.string(), z.object({ stargazerCount: NonNegativeInt }).strict().nullable()), 1, opts);
    batch.forEach((r, j) => {
      const node = data[`r${j}`];
      if (node && typeof node.stargazerCount === "number") out.set(r.id, node.stargazerCount);
    });
    if (i + batchSize < refs.length) await sleep(BATCH_PAUSE_MS);
  }
  return out;
}

// --- REST Search: whitelist (stars ≥ N) ---

const SearchRepoSchema = z.object({
  id: NonNegativeInt,
  node_id: z.string(),
  full_name: z.string(),
  name: z.string(),
  stargazers_count: NonNegativeInt,
  owner: z.object({ login: z.string() }).passthrough(),
}).passthrough();
const SearchResultSchema = z.object({
  total_count: NonNegativeInt,
  incomplete_results: z.boolean().optional(),
  items: z.array(SearchRepoSchema),
}).passthrough();
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type RepositorySearch = (
  params: Record<string, string | number>,
  opts?: GitHubFetchOptions,
) => Promise<SearchResult>;

function requireCompleteSearch(result: SearchResult, query: string): SearchResult {
  if (result.incomplete_results) {
    throw new Error(`GitHub Search returned incomplete results for ${query}`);
  }
  return result;
}

async function restSearch(token: string, params: Record<string, string | number>, attempt = 1, opts: GitHubFetchOptions = {}): Promise<SearchResult> {
  const url = new URL(`${REST}/search/repositories`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetchWithTimeout(url, {
    headers: githubApiHeaders(token),
    cache: "no-store",
    timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
  });
  if ((res.status === 403 || isTransientGithubStatus(res.status)) && attempt <= MAX_RETRIES) {
    const text = await res.text();
    await sleep(secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
    return restSearch(token, params, attempt + 1, opts);
  }
  if (!res.ok) throw new GitHubHttpError("search", res.status, await res.text());
  return SearchResultSchema.parse(await res.json());
}

export type WhitelistSearchHopResult = {
  done: boolean;
  progress: WhitelistSearchProgress;
  entries: WhitelistEntryRecord[];
  requests: number;
};

export type SearchWhitelistHopOptions = {
  minStars: number;
  search: RepositorySearch;
  progress?: WhitelistSearchProgress | null;
  budgetMs: number;
  maxStars?: number;
  opts?: GitHubFetchOptions;
  now?: () => number;
  yieldSlackMs?: number;
};

function sortedWhitelistEntries(entries: Iterable<WhitelistEntryRecord>): WhitelistEntryRecord[] {
  return [...entries].sort((a, b) => b.stars - a.stars || a.id - b.id);
}

function canStartSearch(nowMs: number, deadlineMs: number, slackMs: number): boolean {
  if (!Number.isFinite(deadlineMs)) return true;
  return nowMs + slackMs < deadlineMs;
}

function ingestSearchPage(out: Map<number, WhitelistEntryRecord>, result: SearchResult): void {
  for (const r of result.items) {
    const entry = WhitelistEntry.parse({
      id: r.id,
      node_id: r.node_id,
      full_name: r.full_name,
      owner: r.owner.login,
      name: r.name,
      stars: r.stargazers_count,
    });
    out.set(r.id, entry);
  }
}

function snapshotProgress(
  minStars: number,
  observedMax: number,
  queue: Array<[number, number]>,
  out: Map<number, WhitelistEntryRecord>,
): WhitelistSearchProgress {
  return {
    v: 1,
    minStars,
    observedMax,
    queue: queue.map(([low, high]) => ({ low, high })),
    entries: sortedWhitelistEntries(out.values()),
  };
}

/**
 * One Search hop: discover the open upper bound if needed, then drain star
 * ranges until the hop budget. Yields between ranges so one CF Queue isolate
 * stays under the 15 min consumer wall. A started range (split or page-all)
 * finishes before the next budget check.
 */
export async function searchWhitelistHop(args: SearchWhitelistHopOptions): Promise<WhitelistSearchHopResult> {
  const now = args.now ?? Date.now;
  const slack = args.yieldSlackMs ?? WHITELIST_SEARCH_YIELD_SLACK_MS;
  const deadline = now() + args.budgetMs;
  const out = new Map<number, WhitelistEntryRecord>();
  let requests = 0;

  const runSearch = async (params: Record<string, string | number>, query: string): Promise<SearchResult> => {
    requests += 1;
    return requireCompleteSearch(await args.search(params, args.opts), query);
  };

  let minStars = args.minStars;
  let observedMax = args.maxStars;
  let queue: Array<[number, number]> = [];

  if (args.progress) {
    if (args.progress.minStars !== minStars) {
      throw new Error(
        `whitelist search progress minStars ${args.progress.minStars} does not match ${minStars}`,
      );
    }
    minStars = args.progress.minStars;
    observedMax = args.progress.observedMax;
    queue = args.progress.queue.map((range) => [range.low, range.high]);
    for (const entry of args.progress.entries) out.set(entry.id, entry);
  } else {
    if (!canStartSearch(now(), deadline, slack)) {
      throw new Error("whitelist search hop budget is too small to start");
    }
    if (observedMax === undefined) {
      const query = `stars:>=${minStars}`;
      const top = await runSearch({ q: query, sort: "stars", order: "desc", per_page: 1, page: 1 }, query);
      if (top.total_count === 0) {
        const progress = snapshotProgress(minStars, minStars - 1, [], out);
        return { done: true, progress, entries: [], requests };
      }
      observedMax = top.items[0]?.stargazers_count;
      if (observedMax === undefined || observedMax < minStars) {
        throw new Error("GitHub Search returned a non-empty whitelist without a valid maximum star count");
      }
    }
    if (observedMax >= minStars) queue = [[minStars, observedMax]];
  }

  if (observedMax === undefined) {
    throw new Error("whitelist search hop is missing observedMax");
  }

  while (queue.length && canStartSearch(now(), deadline, slack)) {
    const [low, high] = queue.pop()!;
    const q = `stars:${low}..${high}`;
    const first = await runSearch({ q, sort: "stars", order: "desc", per_page: 100, page: 1 }, q);
    if (first.total_count > 1000 && high > low) {
      const mid = Math.floor((low + high) / 2);
      queue.push([low, mid], [mid + 1, high]);
      continue;
    }
    if (first.total_count > 1000) {
      throw new Error(`GitHub Search bucket ${q} has ${first.total_count} results and cannot be paged completely`);
    }
    const pages = Math.min(Math.ceil(first.total_count / 100), 10);
    for (let page = 1; page <= pages; page++) {
      const res = page === 1
        ? first
        : await runSearch({ q, sort: "stars", order: "desc", per_page: 100, page }, `${q} page ${page}`);
      ingestSearchPage(out, res);
    }
  }

  const progress = snapshotProgress(minStars, observedMax, queue, out);
  return {
    done: queue.length === 0,
    progress,
    entries: progress.entries,
    requests,
  };
}

/** Search-backed implementation with an injectable transport for contract tests. */
export async function searchWhitelistWithSearch(
  minStars: number,
  search: RepositorySearch,
  maxStars?: number,
  opts: GitHubFetchOptions = {},
): Promise<WhitelistEntryRecord[]> {
  const hop = await searchWhitelistHop({
    minStars,
    search,
    maxStars,
    opts,
    budgetMs: Number.POSITIVE_INFINITY,
    yieldSlackMs: 0,
  });
  return hop.entries;
}

export function githubRepositorySearch(opts: GitHubFetchOptions = {}): RepositorySearch {
  const token = requireGithubToken();
  return (params, searchOpts) => restSearch(token, params, 1, searchOpts ?? opts);
}

/** Whitelist = Search-discovered repos with stars ≥ minStars. Search determines
 * membership only; GraphQL is authoritative for displayed/ranked star totals. */
export async function searchWhitelist(
  minStars = getMinTrackedStars(),
  maxStars?: number,
  opts: GitHubFetchOptions = {},
): Promise<WhitelistEntryRecord[]> {
  return searchWhitelistWithSearch(minStars, githubRepositorySearch(opts), maxStars, opts);
}

// --- GraphQL nodes(): repo metadata ---

export interface RepoMetadata {
  full_name: string;
  owner: string;
  owner_type: "User" | "Organization";
  name: string;
  description: string | null;
  language: string | null;
  languages: Array<{ name: string; size: number; color: string | null }>;
  topics: string[];
  created_at: string;
  current_stars: number;
  is_archived: boolean;
}

const RepoNodeSchema = z.object({
  databaseId: NonNegativeInt.nullable(),
  nameWithOwner: z.string(),
  owner: z.object({ login: z.string(), __typename: z.enum(["User", "Organization"]) }).passthrough(),
  name: z.string(),
  description: z.string().nullable(),
  primaryLanguage: z.object({ name: z.string() }).passthrough().nullable(),
  languages: z.object({
    edges: z.array(
      z.object({
        size: NonNegativeInt,
        node: z.object({ name: z.string(), color: z.string().nullable() }).passthrough(),
      }).passthrough(),
    ),
  }).passthrough(),
  repositoryTopics: z.object({
    nodes: z.array(z.object({ topic: z.object({ name: z.string() }).passthrough() }).passthrough()),
  }).passthrough(),
  createdAt: z.string(),
  stargazerCount: NonNegativeInt,
  isArchived: z.boolean(),
}).passthrough();
const NodesResponseSchema = z.object({ nodes: z.array(z.unknown().nullable()) }).passthrough();

export const METADATA_GRAPHQL_BATCH = 100;

/** One GraphQL nodes() page (≤100 ids) → Map<databaseId, RepoMetadata>. */
export async function fetchRepositoryMetadata(
  nodeIds: string[],
  opts: GitHubFetchOptions = {},
): Promise<Map<number, RepoMetadata>> {
  const token = requireGithubToken();
  const out = new Map<number, RepoMetadata>();
  if (nodeIds.length === 0) return out;
  const selection =
    "databaseId nameWithOwner owner{login __typename} name description primaryLanguage{name} " +
    "languages(first:10, orderBy:{field:SIZE, direction:DESC}){edges{size node{name color}}} " +
    "repositoryTopics(first:20){nodes{topic{name}}} createdAt stargazerCount isArchived";
  const query = `query{nodes(ids:${JSON.stringify(nodeIds)}){... on Repository{${selection}}}}`;
  const data = await gql(token, query, NodesResponseSchema, 1, opts);
  for (const raw of data.nodes) {
    if (!raw) continue;
    const parsed = RepoNodeSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn("[github] skipped invalid repository node", parsed.error.message.slice(0, 200));
      continue;
    }
    const n = parsed.data;
    if (n.databaseId == null) continue;
    out.set(n.databaseId, {
      full_name: n.nameWithOwner,
      owner: n.owner.login,
      owner_type: n.owner.__typename,
      name: n.name,
      description: n.description,
      language: n.primaryLanguage?.name ?? null,
      languages: n.languages.edges.map((edge) => ({ name: edge.node.name, size: edge.size, color: edge.node.color ?? null })),
      topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
      created_at: n.createdAt,
      current_stars: n.stargazerCount,
      is_archived: n.isArchived,
    });
  }
  return out;
}

/** Batch repo metadata via GraphQL nodes() (100 ids/query) → Map<databaseId, RepoMetadata>.
 *  Ported from pipeline/lib/github.mjs batchMetadata; see docs/VERCEL-DATA-OPERATIONS.md §4 metadata step. */
export async function batchMetadata(nodeIds: string[], opts: GitHubFetchOptions = {}): Promise<Map<number, RepoMetadata>> {
  const out = new Map<number, RepoMetadata>();
  for (let i = 0; i < nodeIds.length; i += METADATA_GRAPHQL_BATCH) {
    const batch = await fetchRepositoryMetadata(nodeIds.slice(i, i + METADATA_GRAPHQL_BATCH), opts);
    for (const [id, meta] of batch) out.set(id, meta);
    if (i + METADATA_GRAPHQL_BATCH < nodeIds.length) await sleep(BATCH_PAUSE_MS);
  }
  return out;
}
