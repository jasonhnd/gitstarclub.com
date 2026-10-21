import type { APIRoute } from "astro";
import { localeSitemapRoute } from "../../../web/lib/sitemap-routes";
import { withPublishedReaders } from "../lib/published-readers";
export const prerender = false;
export const GET: APIRoute = ({ locals }) => withPublishedReaders(locals.data, localeSitemapRoute("ko"), { cloudflareReadPolicy: true });
