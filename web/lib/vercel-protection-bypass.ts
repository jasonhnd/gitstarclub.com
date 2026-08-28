/** Headers that let CI/automation through Vercel Authentication on Preview. */
export function vercelProtectionBypassHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const token = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!token) return {};
  return {
    "x-vercel-protection-bypass": token,
    "x-vercel-set-bypass-cookie": "true",
  };
}

/** Name=value pairs from Set-Cookie, suitable for a Cookie request header. */
export function cookieHeaderFromSetCookie(setCookies: string[]): string | null {
  const pairs = setCookies
    .map((cookie) => cookie.split(";", 1)[0]?.trim())
    .filter((pair): pair is string => Boolean(pair) && pair.includes("="));
  return pairs.length > 0 ? pairs.join("; ") : null;
}

function headerRecord(init?: HeadersInit): Record<string, string> {
  const headers = new Headers(init);
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function setCookieHeaders(response: Response): string[] {
  const listed = response.headers.getSetCookie?.() ?? [];
  if (listed.length > 0) return listed;
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function mergeCookiePairs(existing: string[], incoming: string | null): string[] {
  if (!incoming) return existing;
  const next = [...existing];
  for (const pair of incoming.split("; ")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const index = next.findIndex((item) => item.startsWith(`${name}=`));
    if (index >= 0) next[index] = pair;
    else next.push(pair);
  }
  return next;
}

/**
 * Vercel Authentication accepts the bypass header by setting `_vercel_jwt` and
 * 307'ing to the same path. `fetch` has no cookie jar, so CI must replay that cookie.
 */
export async function fetchWithVercelProtectionBypass(
  input: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = {
    ...headerRecord(init.headers),
    ...vercelProtectionBypassHeaders(),
  };
  let url = new URL(input);
  let cookies: string[] = [];
  let response: Response | null = null;

  for (let hop = 0; hop < 5; hop++) {
    const requestHeaders = { ...headers };
    if (cookies.length > 0) requestHeaders.Cookie = cookies.join("; ");
    response = await fetch(url, {
      ...init,
      headers: requestHeaders,
      redirect: "manual",
    });
    cookies = mergeCookiePairs(cookies, cookieHeaderFromSetCookie(setCookieHeaders(response)));
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location") ?? "";
    if (!location || /vercel\.com\/sso(?:-api)?(?:[/?]|$)/i.test(location)) return response;
    url = new URL(location, url);
  }

  return response as Response;
}
