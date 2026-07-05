// GitHub client: GraphQL (daily cron star counts) + REST Search (whitelist) +
// GraphQL nodes() (metadata). Server-only; needs env GITHUB_TOKEN. See docs/OPS.md.
import { z } from "zod";
import { WhitelistEntry } from "@/lib/contracts";
import { MIN_TRACKED_STARS } from "@/lib/constants";
import { GITHUB_FETCH_TIMEOUT_MS, fetchWithTimeout } from "@/lib/fetch-timeout.mjs";
import type { WhitelistEntry as WhitelistEntryRecord } from "@/lib/contracts";

const TOKEN = process.env.GITHUB_TOKEN;
const ENDPOINT = "https://api.github.com/graphql";
const REST = "https://api.github.com";
const MAX_RETRIES = 4;
const BATCH_PAUSE_MS = 2000;

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

export interface GitHubFetchOptions {
  timeoutMs?: number;
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

async function gql<T>(query: string, schema: z.ZodType<T>, attempt = 1, opts: GitHubFetchOptions = {}): Promise<T> {
  const res = await fetchWithTimeout(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
    timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
  });
  const text = await res.text();
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
    await sleep(secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
    return gql<T>(query, schema, attempt + 1, opts);
  }
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${text.slice(0, 200)}`);
  const json = z.object({ data: z.unknown().optional(), errors: z.unknown().optional() }).passthrough().parse(JSON.parse(text));
  // Partial data + errors is normal (a deleted/renamed repo aliases to null); only fail with no data.
  if (!json.data) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? {}).slice(0, 200)}`);
  if (json.errors) console.warn("[github] GraphQL returned partial errors", JSON.stringify(json.errors).slice(0, 200));
  return schema.parse(json.data);
}

/** Current stargazerCount for each repo → Map<id, stars>. Missing/renamed repos are skipped. */
export async function fetchStarCounts(refs: RepoRef[], batchSize = 100, opts: GitHubFetchOptions = {}): Promise<Map<number, number>> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
  const out = new Map<number, number>();
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    const query = `query{${batch
      .map((r, j) => `r${j}: repository(owner:${JSON.stringify(r.owner)}, name:${JSON.stringify(r.name)}){stargazerCount}`)
      .join(" ")}}`;
    const data = await gql(query, z.record(z.string(), z.object({ stargazerCount: NonNegativeInt }).strict().nullable()), 1, opts);
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
  items: z.array(SearchRepoSchema),
}).passthrough();
type SearchResult = z.infer<typeof SearchResultSchema>;

async function restSearch(params: Record<string, string | number>, attempt = 1, opts: GitHubFetchOptions = {}): Promise<SearchResult> {
  const url = new URL(`${REST}/search/repositories`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "gitstarclub" },
    cache: "no-store",
    timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
  });
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
    const text = await res.text();
    await sleep(secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
    return restSearch(params, attempt + 1, opts);
  }
  if (!res.ok) throw new Error(`GitHub Search ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return SearchResultSchema.parse(await res.json());
}

/** Whitelist = repos with stars ≥ minStars, via adaptive star-range bucketing (Search caps at
 *  1000 results/query: split any bucket >1000 until it fits, then page). Sorted by stars desc.
 *  Ported from pipeline/lib/github.mjs; see docs/PIPELINE.md §1 / VERCEL-DATA-OPERATIONS §4. */
export async function searchWhitelist(minStars = MIN_TRACKED_STARS, maxStars = 600000, opts: GitHubFetchOptions = {}): Promise<WhitelistEntryRecord[]> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
  const out = new Map<number, WhitelistEntryRecord>(); // dedups range-boundary overlap
  const queue: Array<[number, number]> = [[minStars, maxStars]];
  while (queue.length) {
    const [low, high] = queue.pop()!;
    const q = `stars:${low}..${high}`;
    const first = await restSearch({ q, sort: "stars", order: "desc", per_page: 100, page: 1 }, 1, opts);
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
      const res = page === 1 ? first : await restSearch({ q, sort: "stars", order: "desc", per_page: 100, page }, 1, opts);
      for (const r of res.items) {
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
  }
  return [...out.values()].sort((a, b) => b.stars - a.stars);
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

/** Batch repo metadata via GraphQL nodes() (100 ids/query) → Map<databaseId, RepoMetadata>.
 *  Ported from pipeline/lib/github.mjs batchMetadata; see docs/VERCEL-DATA-OPERATIONS.md §4 metadata step. */
export async function batchMetadata(nodeIds: string[], opts: GitHubFetchOptions = {}): Promise<Map<number, RepoMetadata>> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
  const out = new Map<number, RepoMetadata>();
  const selection =
    "databaseId nameWithOwner owner{login __typename} name description primaryLanguage{name} " +
    "languages(first:10, orderBy:{field:SIZE, direction:DESC}){edges{size node{name color}}} " +
    "repositoryTopics(first:20){nodes{topic{name}}} createdAt stargazerCount isArchived";
  for (let i = 0; i < nodeIds.length; i += 100) {
    const ids = nodeIds.slice(i, i + 100);
    const query = `query{nodes(ids:${JSON.stringify(ids)}){... on Repository{${selection}}}}`;
    const data = await gql(query, NodesResponseSchema, 1, opts);
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
    if (i + 100 < nodeIds.length) await sleep(BATCH_PAUSE_MS);
  }
  return out;
}
