// GitHub API client — native fetch, no deps. Needs env GITHUB_TOKEN
// (classic or fine-grained PAT, public repo read). Shared by backfill + weekly.

import { MIN_TRACKED_STARS } from "../../web/lib/constants.mjs";
import { fetchWithTimeout, GITHUB_FETCH_TIMEOUT_MS, isFetchTimeoutError } from "./fetch-timeout.mjs";

const REST = "https://api.github.com";
const GQL = "https://api.github.com/graphql";

function token() {
  const value = process.env.GITHUB_TOKEN?.trim();
  if (!value) throw new Error("GITHUB_TOKEN not set");
  return value;
}

function headers() {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "gitstarclub-pipeline",
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait on rate limit: prefer retry-after, then x-ratelimit-reset, else backoff.
function rateLimitWaitMs(res, attempt) {
  const retryAfter = Number(res.headers.get("retry-after"));
  if (retryAfter) return retryAfter * 1000;
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (reset) return Math.max(reset * 1000 - Date.now(), 0) + 1000;
  return Math.min(2 ** attempt * 1000, 60000);
}

function timeoutWaitMs(attempt) {
  return Math.min(2 ** attempt * 1000, 60000);
}

async function restGet(path, params = {}) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(url, { headers: headers() }, { timeoutMs: GITHUB_FETCH_TIMEOUT_MS, label: "GitHub REST fetch" });
    } catch (error) {
      if (isFetchTimeoutError(error) && attempt <= 8) {
        await sleep(timeoutWaitMs(attempt));
        continue;
      }
      throw error;
    }
    if ((res.status === 403 || res.status === 429) && attempt <= 8) {
      await sleep(rateLimitWaitMs(res, attempt));
      continue;
    }
    if (!res.ok) throw new Error(`GitHub REST ${res.status} ${path}: ${await res.text()}`);
    return res.json();
  }
}

async function gql(query, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        GQL,
        {
          method: "POST",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
        },
        { timeoutMs: GITHUB_FETCH_TIMEOUT_MS, label: "GitHub GraphQL fetch" },
      );
    } catch (error) {
      if (isFetchTimeoutError(error) && attempt <= 8) {
        await sleep(timeoutWaitMs(attempt));
        continue;
      }
      throw error;
    }
    if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt <= 8) {
      await sleep(rateLimitWaitMs(res, attempt));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    return json.data;
  }
}

// Search caps at 1000 results/query → bucket by star ranges, splitting any
// bucket >1000 until it fits, then page through each.
// Returns [{ id, node_id, full_name, owner, name, stars }] sorted by stars desc.
export async function searchWhitelist(minStars = MIN_TRACKED_STARS, maxStars = 600000) {
  const out = new Map(); // id -> repo (dedups range-boundary overlap)
  const queue = [[minStars, maxStars]];
  while (queue.length) {
    const [low, high] = queue.pop();
    const q = `stars:${low}..${high}`;
    const first = await restGet("/search/repositories", {
      q, sort: "stars", order: "desc", per_page: 100, page: 1,
    });
    if (first.total_count > 1000 && high > low) {
      const mid = Math.floor((low + high) / 2);
      queue.push([low, mid], [mid + 1, high]);
      continue;
    }
    const pages = Math.min(Math.ceil(first.total_count / 100), 10);
    for (let page = 1; page <= pages; page++) {
      const res = page === 1
        ? first
        : await restGet("/search/repositories", { q, sort: "stars", order: "desc", per_page: 100, page });
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

// Run a GraphQL nodes() query over node ids in batches of 100; map each
// returned Repository via `pick`. Returns Map<databaseId, picked>.
async function batchNodes(nodeIds, selection, pick) {
  const result = new Map();
  const query = `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Repository { databaseId ${selection} } } }`;
  for (let i = 0; i < nodeIds.length; i += 100) {
    const data = await gql(query, { ids: nodeIds.slice(i, i + 100) });
    for (const n of data.nodes) {
      if (n && n.databaseId != null) result.set(n.databaseId, pick(n));
    }
  }
  return result;
}

// Current authoritative stargazerCount. Returns Map<databaseId, stars>.
export function batchStargazerCounts(nodeIds) {
  return batchNodes(nodeIds, "stargazerCount", (n) => n.stargazerCount);
}

// Full metadata incl. owner_type (User|Organization). Returns Map<databaseId, {...}>.
export function batchMetadata(nodeIds) {
  const selection = `
    nameWithOwner owner { login __typename } name
    description
    primaryLanguage { name }
    repositoryTopics(first: 20) { nodes { topic { name } } }
    createdAt stargazerCount isArchived`;
  return batchNodes(nodeIds, selection, (n) => ({
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
  }));
}
