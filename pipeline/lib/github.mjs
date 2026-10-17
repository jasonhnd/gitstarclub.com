// GitHub API client — native fetch, no deps. Needs env GITHUB_TOKEN
// (classic or fine-grained PAT, public repo read). Shared by backfill + weekly.
//
// Retry limits match web/lib/github.ts. One call makes at most
// GITHUB_MAX_RETRIES extra attempts after the first response. 403, 429, and
// 5xx are retryable. 400 and 401 fail immediately. Retry-After and reset
// waits must be finite and are capped at 60s. Backoff is capped at 30s.

import { resolveMinTrackedStars } from "../../web/lib/constants.mjs";
import { GITHUB_FETCH_TIMEOUT_MS, fetchWithTimeout } from "../../web/lib/fetch-timeout.mjs";

const REST = "https://api.github.com";
const GQL = "https://api.github.com/graphql";

/** Extra attempts after the first response. Total attempts = this value + 1. */
export const GITHUB_MAX_RETRIES = 4;
/** Search pages inside one star bucket. GitHub Search will not page past this. */
export const GITHUB_SEARCH_MAX_PAGES = 10;
export const GITHUB_SEARCH_PAGE_SIZE = 100;
/** GraphQL nodes() ids per request. */
export const GITHUB_GRAPHQL_NODE_BATCH = 100;
const DIAGNOSTIC_LIMIT = 200;

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "gitstarclub-pipeline",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function boundedDiagnostic(value) {
  return String(value ?? "").slice(0, DIAGNOSTIC_LIMIT);
}

/** Same delay rules as web/lib/github.ts retryDelayMs. Attempt is 1-based. */
export function retryDelayMs(res, attempt) {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);

  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (remaining === 0 && Number.isFinite(reset) && reset > 0) {
    return Math.min(Math.max(reset * 1000 - Date.now(), 0) + 1000, 60_000);
  }

  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

/** Same 403 body rule as web/lib/github.ts secondaryLimitDelayMs. */
export function secondaryLimitDelayMs(status, text) {
  if (status !== 403) return null;
  return /secondary rate limit|abuse detection|rate limit/i.test(text) ? 60_000 : null;
}

function retryableGithubStatus(status) {
  return status === 403 || status === 429 || status >= 500;
}

function wait(opts, ms) {
  return (opts.sleep ?? sleep)(ms);
}

async function restGet(path, params = {}, opts = {}) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 1; ; attempt++) {
    const res = await fetchWithTimeout(url, {
      headers: headers(),
      timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
      fetcher: opts.fetcher,
    });
    if (retryableGithubStatus(res.status) && attempt <= GITHUB_MAX_RETRIES) {
      const text = await res.text();
      await wait(opts, secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
      continue;
    }
    if (!res.ok) {
      throw new Error(`GitHub REST ${res.status} ${path}: ${boundedDiagnostic(await res.text())}`);
    }
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error(`GitHub REST invalid data ${path}: response was not JSON`);
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new Error(`GitHub REST invalid data ${path}: body was not an object`);
    }
    return json;
  }
}

async function gql(query, variables = {}, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetchWithTimeout(GQL, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      timeoutMs: opts.timeoutMs ?? GITHUB_FETCH_TIMEOUT_MS,
      fetcher: opts.fetcher,
    });
    if (retryableGithubStatus(res.status) && attempt <= GITHUB_MAX_RETRIES) {
      const text = await res.text();
      await wait(opts, secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${boundedDiagnostic(text)}`);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`GitHub GraphQL invalid data: ${boundedDiagnostic(text)}`);
    }
    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new Error("GitHub GraphQL invalid data: body was not an object");
    }
    if (json.errors) throw new Error(`GraphQL errors: ${boundedDiagnostic(JSON.stringify(json.errors))}`);
    if (json.data == null || typeof json.data !== "object" || Array.isArray(json.data)) {
      throw new Error(`GitHub GraphQL invalid data: ${boundedDiagnostic(JSON.stringify(json.data))}`);
    }
    return json.data;
  }
}

// Search caps at 1000 results/query → bucket by star ranges, splitting any
// bucket >1000 until it fits, then page through each.
// Returns [{ id, node_id, full_name, owner, name, stars }] sorted by stars desc.
export async function searchWhitelist(minStars = resolveMinTrackedStars(process.env.MIN_TRACKED_STARS), maxStars, opts = {}) {
  const out = new Map(); // id -> repo (dedups range-boundary overlap)
  let observedMax = maxStars;
  if (observedMax === undefined) {
    const top = await restGet("/search/repositories", {
      q: `stars:>=${minStars}`, sort: "stars", order: "desc", per_page: 1, page: 1,
    }, opts);
    if (top.incomplete_results) throw new Error(`GitHub Search returned incomplete results for stars:>=${minStars}`);
    if (top.total_count === 0) return [];
    observedMax = top.items[0]?.stargazers_count;
    if (!Number.isSafeInteger(observedMax) || observedMax < minStars) {
      throw new Error("GitHub Search returned a non-empty whitelist without a valid maximum star count");
    }
  }
  if (observedMax < minStars) return [];
  const queue = [[minStars, observedMax]];
  while (queue.length) {
    const range = queue.pop();
    if (!range) break;
    const [low, high] = range;
    const q = `stars:${low}..${high}`;
    const first = await restGet("/search/repositories", {
      q, sort: "stars", order: "desc", per_page: GITHUB_SEARCH_PAGE_SIZE, page: 1,
    }, opts);
    if (first.incomplete_results) throw new Error(`GitHub Search returned incomplete results for ${q}`);
    if (first.total_count > 1000 && high > low) {
      const mid = Math.floor((low + high) / 2);
      queue.push([low, mid], [mid + 1, high]);
      continue;
    }
    if (first.total_count > 1000) {
      throw new Error(`GitHub Search bucket ${q} has ${first.total_count} results and cannot be paged completely`);
    }
    const pages = Math.min(Math.ceil(first.total_count / GITHUB_SEARCH_PAGE_SIZE), GITHUB_SEARCH_MAX_PAGES);
    if (pages > 0 && !Array.isArray(first.items)) {
      throw new Error(`GitHub Search invalid data for ${q}: items must be an array`);
    }
    for (let page = 1; page <= pages; page++) {
      const res = page === 1
        ? first
        : await restGet("/search/repositories", { q, sort: "stars", order: "desc", per_page: GITHUB_SEARCH_PAGE_SIZE, page }, opts);
      if (page > 1 && !Array.isArray(res.items)) {
        throw new Error(`GitHub Search invalid data for ${q} page ${page}: items must be an array`);
      }
      if (res.incomplete_results) throw new Error(`GitHub Search returned incomplete results for ${q} page ${page}`);
      for (const r of res.items) {
        out.set(r.id, {
          id: r.id,
          node_id: r.node_id,
          full_name: r.full_name,
          owner: r.owner.login,
          name: r.name,
          stars: r.stargazers_count,
        });
      }
    }
  }
  return [...out.values()].sort((a, b) => b.stars - a.stars);
}

// Run a GraphQL nodes() query over node ids in batches of GITHUB_GRAPHQL_NODE_BATCH; map each
// returned Repository via `pick`. Returns Map<databaseId, picked>.
async function batchNodes(nodeIds, selection, pick, opts = {}) {
  const result = new Map();
  const query = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Repository { databaseId ${selection} } } }`;
  for (let i = 0; i < nodeIds.length; i += GITHUB_GRAPHQL_NODE_BATCH) {
    const data = await gql(query, { ids: nodeIds.slice(i, i + GITHUB_GRAPHQL_NODE_BATCH) }, opts);
    if (!Array.isArray(data.nodes)) {
      throw new Error("GitHub GraphQL invalid data: nodes must be an array");
    }
    for (const n of data.nodes) {
      if (n == null) continue;
      // An inline fragment on Repository is an empty object for every other
      // node type. Arrays are not those objects.
      if (typeof n !== "object" || Array.isArray(n)) {
        throw new Error("GitHub GraphQL invalid data: node was not an object");
      }
      if (n.databaseId == null) continue;
      result.set(n.databaseId, pick(n));
    }
  }
  return result;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** Name of the first mapped field that cannot be stored, or "" when the node is usable. */
function repositoryProblem(node) {
  if (!isSafeCount(node.databaseId)) return "databaseId";
  if (!isNonEmptyString(node.nameWithOwner)) return "nameWithOwner";
  if (!isPlainObject(node.owner)) return "owner";
  if (!isNonEmptyString(node.owner.login)) return "owner.login";
  if (node.owner.__typename !== "User" && node.owner.__typename !== "Organization") return "owner.__typename";
  if (typeof node.name !== "string") return "name";
  if (!(node.description === null || typeof node.description === "string")) return "description";
  const language = node.primaryLanguage;
  if (!(language === null || (isPlainObject(language) && typeof language.name === "string"))) {
    return "primaryLanguage";
  }
  if (!isPlainObject(node.repositoryTopics) || !Array.isArray(node.repositoryTopics.nodes)) return "repositoryTopics";
  for (const topicNode of node.repositoryTopics.nodes) {
    if (!isPlainObject(topicNode) || !isPlainObject(topicNode.topic) || typeof topicNode.topic.name !== "string") {
      return "repositoryTopics";
    }
  }
  if (!isNonEmptyString(node.createdAt)) return "createdAt";
  if (!isSafeCount(node.stargazerCount)) return "stargazerCount";
  if (typeof node.isArchived !== "boolean") return "isArchived";
  return "";
}

function rejectRepository(node) {
  const field = repositoryProblem(node);
  if (!field) return;
  const id = isSafeCount(node.databaseId) ? String(node.databaseId) : "invalid-id";
  throw new Error(
    `GitHub GraphQL invalid data: repository ${id} field ${field}: ${boundedDiagnostic(JSON.stringify(node))}`,
  );
}

// Full metadata incl. owner_type (User|Organization). Returns Map<databaseId, {...}>.
// A present databaseId is a repository payload. Fields are checked before they
// are read, so a bad owner or star count cannot be stored or throw a TypeError.
export function batchMetadata(nodeIds, opts = {}) {
  const selection = `
    nameWithOwner owner { login __typename } name
    description
    primaryLanguage { name }
    repositoryTopics(first: 20) { nodes { topic { name } } }
    createdAt stargazerCount isArchived`;
  return batchNodes(nodeIds, selection, (n) => {
    rejectRepository(n);
    return {
      full_name: n.nameWithOwner,
      owner: n.owner.login,
      owner_type: n.owner.__typename, // "User" | "Organization"
      name: n.name,
      description: n.description,
      language: n.primaryLanguage?.name ?? null,
      topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
      created_at: n.createdAt,
      current_stars: n.stargazerCount,
      is_archived: n.isArchived,
    };
  }, opts);
}
