import { getRepoCurve } from "@/lib/data";

// CDN-cached per-repo curve endpoint for the /compare page (v0.2 §5). The compare client fetches
// /repo-curve?id=<id> for each selected repo, then overlays them in the browser. Reading happens
// server-side (Blob stays server-only, resolved through the publish pointer); the Vercel CDN serves
// each id's response via s-maxage, so steady state is effectively zero-backend. Same pattern as
// app/search-index/route.ts. See docs/DATA-CONTRACTS.md §2.15.

const HIT = "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";
const MISS = "public, max-age=0, s-maxage=60"; // bad/absent id — recover fast, don't pin a 404 at the edge

export async function GET(req: Request): Promise<Response> {
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "invalid id" }, { status: 400, headers: { "Cache-Control": MISS } });
  }
  const curve = await getRepoCurve(id);
  if (!curve) {
    return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": MISS } });
  }
  return Response.json(curve, { headers: { "Cache-Control": HIT } });
}
