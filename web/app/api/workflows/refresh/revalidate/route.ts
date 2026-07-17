import { requireBearerToken } from "@/lib/security";
import { invalidatePublishedViews } from "@/lib/workflows/publication-cache";

export const dynamic = "force-dynamic";

/** Internal callback used by a fenced publish/rollback after pointer commit. */
export async function POST(req: Request): Promise<Response> {
  const unauthorized = requireBearerToken(req.headers.get("authorization"));
  if (unauthorized) return unauthorized;
  await invalidatePublishedViews();
  return Response.json({ ok: true });
}
