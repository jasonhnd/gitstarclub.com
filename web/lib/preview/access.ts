/** Cloudflare Access Service Token headers for the non-production Preview host. */
export function cloudflareAccessHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const clientId = env.CF_ACCESS_CLIENT_ID?.trim();
  const clientSecret = env.CF_ACCESS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return {};
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  };
}
