import type { APIRoute } from "astro";
import { getSearchIndex } from "../../../web/lib/data/search";
import { buildSearchIndexResponse } from "../../../web/lib/search-index-response";
import { withPublishedReads } from "../packages/p6/published-reads";
export const prerender = false;
export const GET: APIRoute = () => withPublishedReads(() => buildSearchIndexResponse(getSearchIndex));
