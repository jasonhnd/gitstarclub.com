import type { APIRoute } from "astro";
import { getSearchIndex } from "../../../web/lib/data/search";
import { buildSearchIndexResponse } from "../../../web/lib/search-index-response";
import { withPublishedReaders } from "../lib/published-readers";
export const prerender = false;
export const GET: APIRoute = ({ locals }) => withPublishedReaders(locals.data, () => buildSearchIndexResponse(getSearchIndex), { cloudflareReadPolicy: true });
