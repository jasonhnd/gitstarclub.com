import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  PUBLICATION_INVALIDATION_PATH,
  PUBLICATION_INVALIDATION_TIMEOUT_MS,
  requestPublishedViewsInvalidation,
  resolvePublicationInvalidationOrigin,
  type InvalidationFetch,
} from "./publication-invalidation-request";

const SECRET = "CANARYCRONSECRET1234567890abcd";
const PREVIEW_ORIGIN = "https://pre.gitstarclub.com";
const PRODUCTION_ORIGIN = "https://gitstarclub.com";

// Mirrors wrangler.jsonc: env.pre does not inherit top-level vars, so the
// preview Worker has CF_CRON_ORIGIN and DEPLOY_ENV but no NEXT_PUBLIC_SITE_URL.
const previewEnv = {
  HOSTING_TARGET: "cf",
  DEPLOY_ENV: "pre",
  CF_CRON_ORIGIN: PREVIEW_ORIGIN,
  CRON_SECRET: SECRET,
};

const productionCfEnv = {
  HOSTING_TARGET: "cf",
  NEXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN,
  CF_CRON_ORIGIN: PRODUCTION_ORIGIN,
  CRON_SECRET: SECRET,
};

function withoutKey(env: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== key));
}

type Captured = { url: string; init: RequestInit };

function fetchCapture(respond: (captured: Captured) => Promise<Response> | Response = () => Response.json({ ok: true })) {
  const calls: Captured[] = [];
  const fetchImpl: InvalidationFetch = async (url, init) => {
    const captured = { url, init };
    calls.push(captured);
    return respond(captured);
  };
  return { calls, fetchImpl };
}

function hangUntilAborted(): InvalidationFetch {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init.signal;
      if (!signal) {
        reject(new Error("test fetch expected an abort signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected an Error, got ${String(error)}`);
  }
  throw new Error("expected the promise to reject");
}

// Every request goes through the injected fetch capture. A real network call
// would mean the code ignored it, so fail instead of sending one.
let networkGuard: ReturnType<typeof spyOn>;

beforeEach(() => {
  networkGuard = spyOn(globalThis, "fetch").mockImplementation((() => {
    throw new Error("unexpected network call from a publication test");
  }) as unknown as typeof fetch);
});

afterEach(() => {
  const networkCalls = networkGuard.mock.calls.length;
  networkGuard.mockRestore();
  expect(networkCalls).toBe(0);
});

describe("resolvePublicationInvalidationOrigin", () => {
  test("preview uses CF_CRON_ORIGIN and never the production site", () => {
    expect(resolvePublicationInvalidationOrigin(previewEnv)).toBe(PREVIEW_ORIGIN);
  });

  test("preview ignores a leaked production NEXT_PUBLIC_SITE_URL or VERCEL_URL", () => {
    expect(
      resolvePublicationInvalidationOrigin({
        ...previewEnv,
        NEXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN,
        VERCEL_URL: "gitstarclub.com",
      }),
    ).toBe(PREVIEW_ORIGIN);
  });

  test("preview without CF_CRON_ORIGIN fails closed instead of falling back to production", () => {
    const missing = withoutKey(previewEnv, "CF_CRON_ORIGIN");
    expect(() => resolvePublicationInvalidationOrigin(missing)).toThrow(/CF_CRON_ORIGIN is required/);
    expect(() => resolvePublicationInvalidationOrigin({ ...missing, CF_CRON_ORIGIN: "   " })).toThrow(
      /CF_CRON_ORIGIN is required/,
    );
    expect(() =>
      resolvePublicationInvalidationOrigin({ ...missing, NEXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN }),
    ).toThrow(/CF_CRON_ORIGIN is required/);
  });

  test("DEPLOY_ENV=pre refuses a production host on either hosting target", () => {
    for (const origin of [PRODUCTION_ORIGIN, "https://www.gitstarclub.com", "https://GITSTARCLUB.com/"]) {
      expect(() => resolvePublicationInvalidationOrigin({ ...previewEnv, CF_CRON_ORIGIN: origin })).toThrow(
        /DEPLOY_ENV=pre must not invalidate the production site/,
      );
    }
    expect(() =>
      resolvePublicationInvalidationOrigin({ DEPLOY_ENV: "pre", NEXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN }),
    ).toThrow(/DEPLOY_ENV=pre must not invalidate the production site/);
  });

  test("Cloudflare production keeps the production origin", () => {
    expect(resolvePublicationInvalidationOrigin(productionCfEnv)).toBe(PRODUCTION_ORIGIN);
    expect(resolvePublicationInvalidationOrigin({ ...productionCfEnv, CF_CRON_ORIGIN: `${PRODUCTION_ORIGIN}/` })).toBe(
      PRODUCTION_ORIGIN,
    );
    expect(resolvePublicationInvalidationOrigin({ ...productionCfEnv, DEPLOY_ENV: "production" })).toBe(
      PRODUCTION_ORIGIN,
    );
  });

  test("a Cloudflare production deployment refuses a non-production origin", () => {
    expect(() =>
      resolvePublicationInvalidationOrigin({ ...productionCfEnv, DEPLOY_ENV: "production", CF_CRON_ORIGIN: PREVIEW_ORIGIN }),
    ).toThrow(/production deployment must invalidate the production site/);
  });

  test("Cloudflare without CF_CRON_ORIGIN fails closed even when NEXT_PUBLIC_SITE_URL is set", () => {
    const missing = withoutKey(productionCfEnv, "CF_CRON_ORIGIN");
    expect(() => resolvePublicationInvalidationOrigin(missing)).toThrow(/CF_CRON_ORIGIN is required/);
  });

  test("Vercel keeps the deployment URL, then NEXT_PUBLIC_SITE_URL", () => {
    expect(resolvePublicationInvalidationOrigin({ VERCEL_URL: "gitstarclub-abc123.vercel.app" })).toBe(
      "https://gitstarclub-abc123.vercel.app",
    );
    expect(
      resolvePublicationInvalidationOrigin({
        VERCEL_URL: "https://gitstarclub-abc123.vercel.app/",
        NEXT_PUBLIC_SITE_URL: PRODUCTION_ORIGIN,
      }),
    ).toBe("https://gitstarclub-abc123.vercel.app");
    expect(resolvePublicationInvalidationOrigin({ NEXT_PUBLIC_SITE_URL: `${PRODUCTION_ORIGIN}/` })).toBe(PRODUCTION_ORIGIN);
    expect(
      resolvePublicationInvalidationOrigin({ VERCEL_ENV: "production", VERCEL_URL: "gitstarclub-abc123.vercel.app" }),
    ).toBe("https://gitstarclub-abc123.vercel.app");
  });

  test("no configured origin fails closed instead of defaulting to production", () => {
    expect(() => resolvePublicationInvalidationOrigin({})).toThrow(
      /publication cache invalidation origin is not configured/,
    );
    expect(() => resolvePublicationInvalidationOrigin({ VERCEL_URL: " ", NEXT_PUBLIC_SITE_URL: "" })).toThrow(
      /publication cache invalidation origin is not configured/,
    );
  });

  test("rejects origins that are not a bare https origin", () => {
    for (const origin of [
      "pre.gitstarclub.com",
      "http://pre.gitstarclub.com",
      "ftp://pre.gitstarclub.com",
      "https://pre.gitstarclub.com/api",
      "https://pre.gitstarclub.com?x=1",
      "https://pre.gitstarclub.com#frag",
      "https://user:pass@pre.gitstarclub.com",
    ]) {
      expect(() => resolvePublicationInvalidationOrigin({ ...previewEnv, CF_CRON_ORIGIN: origin })).toThrow(
        /CF_CRON_ORIGIN must be/,
      );
    }
  });

  test("accepts plain http only for a loopback host", () => {
    expect(resolvePublicationInvalidationOrigin({ NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
    expect(resolvePublicationInvalidationOrigin({ ...previewEnv, CF_CRON_ORIGIN: "http://127.0.0.1:8787" })).toBe(
      "http://127.0.0.1:8787",
    );
  });

  test("refuses the closed production workers.dev host", () => {
    expect(() =>
      resolvePublicationInvalidationOrigin({
        ...productionCfEnv,
        CF_CRON_ORIGIN: "https://gitstarclub-web.worldgo.workers.dev",
      }),
    ).toThrow(/closed production workers.dev host/);
  });

  test("an invalid DEPLOY_ENV or HOSTING_TARGET fails closed", () => {
    expect(() => resolvePublicationInvalidationOrigin({ ...previewEnv, DEPLOY_ENV: "staging" })).toThrow(
      /DEPLOY_ENV must be/,
    );
    expect(() => resolvePublicationInvalidationOrigin({ ...previewEnv, HOSTING_TARGET: "netlify" })).toThrow(
      /HOSTING_TARGET must be/,
    );
  });
});

describe("requestPublishedViewsInvalidation", () => {
  test("preview POSTs the bearer callback to the preview deployment only", async () => {
    const { calls, fetchImpl } = fetchCapture();

    await requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${PREVIEW_ORIGIN}${PUBLICATION_INVALIDATION_PATH}`);
    expect(calls[0]?.url.startsWith(PRODUCTION_ORIGIN)).toBe(false);
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("Cloudflare production keeps the same callback URL", async () => {
    const { calls, fetchImpl } = fetchCapture();

    await requestPublishedViewsInvalidation({ env: productionCfEnv, fetchImpl });

    expect(calls.map((call) => call.url)).toEqual(["https://gitstarclub.com/api/workflows/refresh/revalidate"]);
  });

  test("missing origin config fails before any request", async () => {
    const { calls, fetchImpl } = fetchCapture();
    const missing = withoutKey(previewEnv, "CF_CRON_ORIGIN");

    const error = await rejectionOf(requestPublishedViewsInvalidation({ env: missing, fetchImpl }));

    expect(error.message).toMatch(/CF_CRON_ORIGIN is required/);
    expect(calls).toHaveLength(0);
  });

  test("missing CRON_SECRET fails before any request", async () => {
    const { calls, fetchImpl } = fetchCapture();
    const missing = withoutKey(previewEnv, "CRON_SECRET");

    const error = await rejectionOf(requestPublishedViewsInvalidation({ env: missing, fetchImpl }));

    expect(error.message).toBe("CRON_SECRET not set for publication cache invalidation");
    expect(calls).toHaveLength(0);
  });

  test("a non-2xx response names the target and status without the secret", async () => {
    const { calls, fetchImpl } = fetchCapture(() => new Response("upstream down", { status: 503 }));

    const error = await rejectionOf(requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl }));

    expect(calls).toHaveLength(1);
    expect(error.message).toBe(
      `publication cache invalidation POST ${PREVIEW_ORIGIN}${PUBLICATION_INVALIDATION_PATH} -> 503`,
    );
    expect(error.message).not.toContain(SECRET);
  });

  test("a hung callback times out with a clear error", async () => {
    const error = await rejectionOf(
      requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl: hangUntilAborted(), timeoutMs: 5 }),
    );

    expect(error.message).toBe(
      `publication cache invalidation POST ${PREVIEW_ORIGIN}${PUBLICATION_INVALIDATION_PATH} timed out after 5ms`,
    );
    expect(error.message).not.toContain(SECRET);
  });

  test("a network error names the target and keeps the cause", async () => {
    const cause = new TypeError("fetch failed");
    const fetchImpl: InvalidationFetch = async () => {
      throw cause;
    };

    const error = await rejectionOf(requestPublishedViewsInvalidation({ env: previewEnv, fetchImpl }));

    expect(error.message).toBe(
      `publication cache invalidation POST ${PREVIEW_ORIGIN}${PUBLICATION_INVALIDATION_PATH} failed: fetch failed`,
    );
    expect(error.cause).toBe(cause);
  });

  test("the default timeout is bounded well inside the 15 minute Queue wall", () => {
    expect(PUBLICATION_INVALIDATION_TIMEOUT_MS).toBe(30_000);
  });
});
