export const dynamic = "force-dynamic";

export function GET(): Response {
  const deploymentHost = process.env.VERCEL_URL?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "") || null;

  return Response.json(
    {
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
      deploymentUrl: deploymentHost ? `https://${deploymentHost}` : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
