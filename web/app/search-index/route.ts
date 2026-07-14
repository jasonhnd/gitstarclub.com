import { getSearchIndex } from "@/lib/data";
import { buildSearchIndexResponse } from "@/lib/search-index-response";

// CDN-cached search index endpoint. The SearchBox fetches this once on first focus, then
// builds the MiniSearch index in a Web Worker. Reading happens server-side (Blob stays
// server-only, resolved through the publish pointer); the Vercel CDN serves the response via
// s-maxage, so steady state is effectively zero-backend. See docs/FRONTEND.md and docs/DATA-CONTRACTS.md.

export async function GET(): Promise<Response> {
  return buildSearchIndexResponse(getSearchIndex);
}
