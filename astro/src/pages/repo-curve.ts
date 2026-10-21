import type { APIRoute } from "astro";
import { parsePositiveIntegerParam } from "../../../web/lib/route-utils";
import { repositoryCurve } from "../packages/p2/data";
export const prerender = false;
const HIT = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const MISS = "public, max-age=0, s-maxage=60";
// Preserve the pinned old framework's response variation contract during migration.
const VARY = "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url, X-Vinext-Interception-Context, X-Vinext-Interception-Id, X-Vinext-Mounted-Slots, X-Vinext-Rsc-Render-Mode, X-Vinext-Rsc-State-Fingerprint";
export const GET: APIRoute = async ({ request, locals }) => {
  const id = parsePositiveIntegerParam(new URL(request.url).searchParams.get("id"));
  if (id === null) return Response.json({ error: "invalid id" }, { status: 400, headers: { "Cache-Control": MISS, Vary: VARY } });
  const curve = await repositoryCurve(locals.data, id);
  if (!curve) return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": MISS, Vary: VARY } });
  return Response.json(curve, { headers: { "Cache-Control": HIT, Vary: VARY } });
};
export const HEAD: APIRoute = GET;
// Preserve the old framework's automatic OPTIONS and unsupported-method responses.
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: { Allow: "GET, HEAD, OPTIONS", Vary: VARY } });
export const ALL: APIRoute = ({ request }) => new Response(null, { status: ["POST", "PUT", "DELETE", "PATCH"].includes(request.method) ? 405 : 400, headers: { Vary: VARY } });
