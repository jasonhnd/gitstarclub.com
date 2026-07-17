function deploymentOrigin(): string {
  const vercelUrl = process.env.VERCEL_URL?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (vercelUrl) return `https://${vercelUrl}`;
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://gitstarclub.com").replace(/\/+$/, "");
}

/** Ask the owning Next deployment to invalidate its data/route caches. */
export async function requestPublishedViewsInvalidation(): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET not set for publication cache invalidation");
  const response = await fetch(`${deploymentOrigin()}/api/workflows/refresh/revalidate`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`publication cache invalidation -> ${response.status}`);
}
