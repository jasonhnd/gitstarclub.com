import type { APIRoute } from "astro";
import { localeSitemapRoute } from "../../../web/lib/sitemap-routes";
export const prerender = false;
export const GET: APIRoute = () => localeSitemapRoute("ko")();
