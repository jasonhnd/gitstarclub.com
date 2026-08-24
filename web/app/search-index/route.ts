import { getSearchIndex } from "@/lib/data";
import { buildSearchIndexResponse } from "@/lib/search-index-response";

// CDN-cached search index endpoint. The SearchBox fetches this once on first focus, then
// builds the MiniSearch index in a Web Worker. Reading happens server-side (Blob stays
// server-only, resolved through the publish pointer); the Vercel CDN serves the response via
// s-maxage, so steady state is effectively zero-backend. The Blob GET skips Next.js Data
// Cache so a ~1.4MB index is not copied into a second cache layer. See docs/FRONTEND.md.

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return buildSearchIndexResponse(getSearchIndex);
}
