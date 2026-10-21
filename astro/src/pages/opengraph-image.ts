import type { APIRoute } from "astro";
import { siteCard } from "../../../web/lib/og-card";

export const prerender = false;
export const GET: APIRoute = () => siteCard();
export const HEAD: APIRoute = GET;
