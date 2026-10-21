import type { APIRoute } from "astro";
import manifest from "../../../web/app/manifest";
export const prerender = false;
export const GET: APIRoute = () => new Response(JSON.stringify(manifest(), null, 2), {
  headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=0, must-revalidate" },
});
