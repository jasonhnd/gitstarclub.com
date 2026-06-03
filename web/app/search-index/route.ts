import { getSearchIndex } from "@/lib/data";

// CDN-cached search index endpoint. The SearchBox fetches this once on first focus, then
// builds the MiniSearch index in the browser. Reading happens server-side (Blob stays
// server-only, resolved through the publish pointer); the Vercel CDN serves the response via
// s-maxage, so steady state is effectively zero-backend. See docs/V0.2-DESIGN.md §1.

const HIT = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const MISS = "public, max-age=0, s-maxage=60"; // before the first publish — recover fast

export async function GET(): Promise<Response> {
  const index = await getSearchIndex();
  if (!index) {
    return Response.json({ generated_at: "", count: 0, repos: [] }, { headers: { "Cache-Control": MISS } });
  }
  return Response.json(index, { headers: { "Cache-Control": HIT } });
}
