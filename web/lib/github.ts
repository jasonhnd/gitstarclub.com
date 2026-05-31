// Minimal GitHub GraphQL client for the daily cron: batch current stargazerCount by
// owner/name (aliased queries). Server-only; needs env GITHUB_TOKEN. See docs/OPS.md.

const TOKEN = process.env.GITHUB_TOKEN;
const ENDPOINT = "https://api.github.com/graphql";
const MAX_RETRIES = 4;
const BATCH_PAUSE_MS = 2000;

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function gql(query: string, attempt = 1): Promise<Record<string, { stargazerCount: number } | null>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  const text = await res.text();
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
    await sleep(secondaryLimitDelayMs(res.status, text) ?? retryDelayMs(res, attempt));
    return gql(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text) as { data?: Record<string, { stargazerCount: number } | null>; errors?: unknown };
  // Partial data + errors is normal (a deleted/renamed repo aliases to null); only fail with no data.
  if (!json.data) throw new Error(`GraphQL: ${JSON.stringify(json.errors ?? {}).slice(0, 200)}`);
  return json.data;
}

/** Current stargazerCount for each repo → Map<id, stars>. Missing/renamed repos are skipped. */
export async function fetchStarCounts(refs: RepoRef[], batchSize = 100): Promise<Map<number, number>> {
  if (!TOKEN) throw new Error("GITHUB_TOKEN not set");
  const out = new Map<number, number>();
  for (let i = 0; i < refs.length; i += batchSize) {
    const batch = refs.slice(i, i + batchSize);
    const query = `query{${batch
      .map((r, j) => `r${j}: repository(owner:${JSON.stringify(r.owner)}, name:${JSON.stringify(r.name)}){stargazerCount}`)
      .join(" ")}}`;
    const data = await gql(query);
    batch.forEach((r, j) => {
      const node = data[`r${j}`];
      if (node && typeof node.stargazerCount === "number") out.set(r.id, node.stargazerCount);
    });
    if (i + batchSize < refs.length) await sleep(BATCH_PAUSE_MS);
  }
  return out;
}
