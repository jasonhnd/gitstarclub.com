import { buildDeploymentIdentity } from "@/lib/deployment-identity";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  return Response.json(buildDeploymentIdentity(request.url), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
