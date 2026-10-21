import type { APIRoute } from "astro";
import { getSearchIndex } from "../../../web/lib/data/search";
import { buildSearchIndexResponse } from "../../../web/lib/search-index-response";
export const prerender = false;
export const GET: APIRoute = () => buildSearchIndexResponse(getSearchIndex);
