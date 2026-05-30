// Minimal GitHub GraphQL client for the daily cron: batch current stargazerCount by
// owner/name (aliased queries). Server-only; needs env GITHUB_TOKEN. See docs/OPS.md.

const TOKEN = process.env.GITHUB_TOKEN;
const ENDPOINT = "https://api.github.com/graphql";

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

async function gql(query: string, attempt = 1): Promise<Record<string, { stargazerCount: number } | null>> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && attempt <= 4) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    return gql(query, attempt + 1);
  }
  if (!res.ok) throw new Error(`GitHub GraphQL ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, { stargazerCount: number } | null>; errors?: unknown };
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
  }
  return out;
}
