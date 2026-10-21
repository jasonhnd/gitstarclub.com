import type { APIRoute } from "astro";
import { sitemapIndexRoute } from "../../../web/lib/sitemap-routes";
export const prerender = false;
export const GET: APIRoute = () => sitemapIndexRoute();
