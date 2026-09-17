/// <reference types="bun" />

import { cloudflareAccessHeaders } from "../lib/preview/access";
import { workersHostSmokeOrigin } from "../lib/workers-host/smoke-origin";

if (import.meta.main) await main();

type SmokeEnv = Record<string, string | undefined>;

function smokeHeaders(env: SmokeEnv, accept: string): Record<string, string> {
  return {
    Accept: accept,
    ...cloudflareAccessHeaders(env),
  };
}

async function fetchSmoke(
  origin: string,
  path: string,
  env: SmokeEnv,
  init: RequestInit = {},
): Promise<Response> {
  const accept = typeof init.headers === "object" && init.headers && "Accept" in init.headers
    ? String((init.headers as Record<string, string>).Accept)
    : "text/html,application/json";
  return fetch(new URL(path, `${origin}/`), {
    ...init,
    headers: {
      ...smokeHeaders(env, accept),
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(30_000),
    redirect: "manual",
  });
}

function assertStatus(path: string, response: Response, allowed: number[]): void {
  if (allowed.includes(response.status)) return;
  throw new Error(`${path} -> HTTP ${response.status} (expected ${allowed.join("|")})`);
}

async function main(): Promise<void> {
  const env = process.env;
  const origin = workersHostSmokeOrigin(env);
  console.log(`CF Workers host smoke origin=${origin}`);

  const health = await fetchSmoke(origin, "/preview/health", env, {
    headers: { Accept: "application/json" },
  });
  assertStatus("/preview/health", health, [200]);
  const healthBody = (await health.json()) as { ok?: boolean; target?: string };
  if (healthBody.ok !== true || healthBody.target !== "cf") {
    throw new Error(`/preview/health unexpected body: ${JSON.stringify(healthBody)}`);
  }
  console.log("health ok");

  const home = await fetchSmoke(origin, "/", env);
  assertStatus("/", home, [200, 307, 308]);
  if (home.status === 200) {
    const html = await home.text();
    if (!html.includes("GitStarClub")) {
      throw new Error("GET / 200 but HTML did not include GitStarClub");
    }
  }
  console.log(`home ${home.status}`);

  const rankings = await fetchSmoke(origin, "/rankings", env);
  assertStatus("/rankings", rankings, [200, 307, 308]);
  console.log(`rankings ${rankings.status}`);

  const cron = await fetchSmoke(origin, "/api/cron/daily", env, {
    headers: { Accept: "application/json" },
  });
  assertStatus("/api/cron/daily", cron, [401]);
  console.log("cron unauthorized ok");

  const storage = await fetchSmoke(origin, "/search-index", env, {
    headers: { Accept: "application/json" },
  });
  assertStatus("/search-index", storage, [200]);
  console.log("storage read /search-index ok");

  if (!env.CRON_SECRET?.trim()) {
    console.log("CRON_SECRET unset; skipping /preview/invalidate");
    return;
  }

  const invalidate = await fetchSmoke(origin, "/preview/invalidate", env, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${env.CRON_SECRET.trim()}`,
    },
    body: JSON.stringify({
      v: 1,
      driver: "cf-stub",
      ops: [
        { kind: "path", path: "/" },
        { kind: "path", path: "/pulse" },
      ],
    }),
  });
  assertStatus("/preview/invalidate", invalidate, [200]);
  const recorded = (await invalidate.json()) as {
    recorded?: Array<{ kind: string; path?: string }>;
  };
  const paths = (recorded.recorded ?? []).filter((op) => op.kind === "path").map((op) => op.path);
  if (!paths.includes("/") || !paths.includes("/pulse")) {
    throw new Error(`invalidate did not record / and /pulse: ${JSON.stringify(recorded)}`);
  }
  console.log("invalidate recorded / and /pulse");
}
