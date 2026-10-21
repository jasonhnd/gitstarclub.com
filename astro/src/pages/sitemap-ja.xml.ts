import type { APIRoute } from "astro";
import { localeSitemapRoute } from "../../../web/lib/sitemap-routes";
import { withPublishedReads } from "../packages/p6/published-reads";
export const prerender = false;
export const GET: APIRoute = () => withPublishedReads(localeSitemapRoute("ja"));
