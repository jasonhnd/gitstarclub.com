import type { APIRoute } from "astro";
import { sitemapIndexRoute } from "../../../web/lib/sitemap-routes";
import { withPublishedReaders } from "../lib/published-readers";
export const prerender = false;
export const GET: APIRoute = ({ locals }) => withPublishedReaders(locals.data, sitemapIndexRoute, { cloudflareReadPolicy: true });
