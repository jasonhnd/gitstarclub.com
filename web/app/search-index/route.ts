import { getSearchIndex } from "@/lib/data";
import type { SearchIndex } from "@/lib/contracts";

// CDN-cached search index endpoint. The SearchBox fetches this once on first focus, then
// builds the MiniSearch index in a Web Worker. Reading happens server-side (Blob stays
// server-only, resolved through the publish pointer); the Vercel CDN serves the response via
// s-maxage, so steady state is effectively zero-backend. See docs/FRONTEND.md and docs/DATA-CONTRACTS.md.

const HIT = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const DESCRIPTION_CAP = 96;

function slimIndex(index: SearchIndex): SearchIndex {
  return {
    ...index,
    repos: index.repos.map((repo) => ({
      ...repo,
      description: repo.description ? repo.description.slice(0, DESCRIPTION_CAP) : null,
    })),
  };
}
const MISS = "public, max-age=0, s-maxage=60"; // before the first publish — recover fast

export async function GET(): Promise<Response> {
  const index = await getSearchIndex();
  if (!index) {
    return Response.json({ generated_at: "", count: 0, repos: [] }, { headers: { "Cache-Control": MISS } });
  }
  return Response.json(slimIndex(index), { headers: { "Cache-Control": HIT } });
}
