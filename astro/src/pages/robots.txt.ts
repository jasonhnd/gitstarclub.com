import type { APIRoute } from "astro";
import robots from "../../../web/app/robots";
import { serializeRobots } from "../packages/p6/robots";
export const prerender = false;
export const GET: APIRoute = () => new Response(serializeRobots(robots()), {
  headers: { "Content-Type": "text/plain", "Cache-Control": "public, max-age=0, must-revalidate" },
});
