import { describe, expect, test } from "bun:test";
import { DEFAULT_CF_PREVIEW_ORIGIN } from "@/lib/runtime-config";
import { cloudflareAccessHeaders } from "./access";
import {
  CF_PREVIEW_POST_DEADLINE_MS,
  cfPreviewHeaders,
  cfPreviewUrl,
  invalidateCfPreviewHotPaths,
  readCfPreviewIdentity,
} from "./cf";

const HUNG_MS = 500;

async function outcomeOf(work: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => "resolved",
        (error: unknown) => error,
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("hung"), HUNG_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function expectTimeout(outcome: unknown): void {
  expect(outcome).toBeInstanceOf(Error);
  expect(outcome).toMatchObject({ name: "TimeoutError", message: "The operation timed out." });
}
import { describePreviewTarget, resolvePreviewTarget } from "./resolve";
import { extractVercelPreviewHost, selectDiscoveryMode, validateVercelDeploymentUrl } from "./vercel-discovery";

describe("preview target resolver", () => {
  test("defaults to Vercel and accepts cf in non-production", () => {
    expect(describePreviewTarget({ env: {} }).target).toBe("vercel");
    expect(resolvePreviewTarget({ env: { PREVIEW_TARGET: "cf" } })).toBe("cf");
  });

  test("refuses CF preview as the production gate", () => {
    expect(() => resolvePreviewTarget({ env: { PREVIEW_TARGET: "cf", VERCEL_ENV: "production" } })).toThrow(
      "VERCEL_ENV=production",
    );
    expect(resolvePreviewTarget({ env: { VERCEL_ENV: "production" } })).toBe("vercel");
  });
});

describe("Cloudflare Access Service Token headers", () => {
  test("omits headers when either credential is missing", () => {
    expect(cloudflareAccessHeaders({})).toEqual({});
    expect(cloudflareAccessHeaders({ CF_ACCESS_CLIENT_ID: "id" })).toEqual({});
    expect(cloudflareAccessHeaders({ CF_ACCESS_CLIENT_SECRET: "secret" })).toEqual({});
  });

  test("sends CF-Access-Client-Id and CF-Access-Client-Secret", () => {
    expect(
      cloudflareAccessHeaders({
        CF_ACCESS_CLIENT_ID: " gitstarclub-cca-ci ",
        CF_ACCESS_CLIENT_SECRET: " tok ",
      }),
    ).toEqual({
      "CF-Access-Client-Id": "gitstarclub-cca-ci",
      "CF-Access-Client-Secret": "tok",
    });
  });
});

describe("CF Preview probe", () => {
  const env = {
    CF_PREVIEW_ORIGIN: DEFAULT_CF_PREVIEW_ORIGIN,
    CF_ACCESS_CLIENT_ID: "access-id",
    CF_ACCESS_CLIENT_SECRET: "access-secret",
    CRON_SECRET: "cron-secret",
  };

  test("defaults the Access-protected preview Worker origin", () => {
    expect(cfPreviewUrl("/preview/identity", env)).toBe(`${DEFAULT_CF_PREVIEW_ORIGIN}/preview/identity`);
    expect(cfPreviewUrl("/preview/identity", {})).toBe(`${DEFAULT_CF_PREVIEW_ORIGIN}/preview/identity`);
  });

  test("requires Access credentials before probing", () => {
    expect(() => cfPreviewHeaders({})).toThrow("CF_ACCESS_CLIENT_ID");
  });

  test("reads identity with Access headers and falls back across paths", async () => {
    const calls: string[] = [];
    const identity = await readCfPreviewIdentity(env, async (input) => {
      calls.push(String(input));
      if (String(input).endsWith("/preview/identity")) {
        return new Response("nope", { status: 404 });
      }
      return Response.json({
        commitSha: "abc123",
        deploymentUrl: DEFAULT_CF_PREVIEW_ORIGIN,
        host: new URL(DEFAULT_CF_PREVIEW_ORIGIN).host,
      });
    });
    expect(calls).toEqual([
      `${DEFAULT_CF_PREVIEW_ORIGIN}/preview/identity`,
      `${DEFAULT_CF_PREVIEW_ORIGIN}/.well-known/deployment`,
    ]);
    expect(identity).toEqual({
      commitSha: "abc123",
      deploymentUrl: DEFAULT_CF_PREVIEW_ORIGIN,
      target: "cf",
      host: new URL(DEFAULT_CF_PREVIEW_ORIGIN).host,
    });
  });

  test("invalidates the / and /pulse hot paths on the Worker stub", async () => {
    const posted: Array<{
      url: string;
      auth: string | null;
      accessId: string | null;
      body: unknown;
      method: string | null;
      aborted: boolean | null;
    }> = [];
    const result = await invalidateCfPreviewHotPaths(env, async (input, init) => {
      const headers = new Headers(init?.headers);
      posted.push({
        url: String(input),
        auth: headers.get("authorization"),
        accessId: headers.get("CF-Access-Client-Id"),
        body: JSON.parse(String(init?.body)),
        method: init?.method ?? null,
        aborted: init?.signal?.aborted ?? null,
      });
      return Response.json({
        ok: true,
        recorded: [
          { kind: "path", path: "/" },
          { kind: "path", path: "/pulse" },
        ],
      });
    });
    expect(posted).toEqual([
      {
        url: `${DEFAULT_CF_PREVIEW_ORIGIN}/preview/invalidate`,
        auth: "Bearer cron-secret",
        accessId: "access-id",
        body: {
          v: 1,
          driver: "cf-stub",
          ops: [
            { kind: "path", path: "/" },
            { kind: "path", path: "/pulse" },
          ],
        },
        method: "POST",
        aborted: false,
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.recorded.map((op) => op.path)).toEqual(["/", "/pulse"]);
    expect(CF_PREVIEW_POST_DEADLINE_MS).toBe(15_000);
  });

  test("aborts a never-settling preview invalidate POST", async () => {
    let sawSignal: AbortSignal | undefined;
    const outcome = await outcomeOf(
      invalidateCfPreviewHotPaths(
        env,
        (_input, init) => {
          sawSignal = init?.signal ?? undefined;
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return;
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        40,
      ),
    );
    expectTimeout(outcome);
    expect(sawSignal?.aborted).toBe(true);
  });

  test("aborts a preview invalidate POST that ignores the abort signal", async () => {
    const outcome = await outcomeOf(invalidateCfPreviewHotPaths(env, () => new Promise(() => {}), 40));
    expectTimeout(outcome);
  });

  test("aborts a preview invalidate body that never settles", async () => {
    let cancelled = false;
    const outcome = await outcomeOf(
      invalidateCfPreviewHotPaths(
        env,
        () =>
          Promise.resolve({
            ok: true,
            status: 200,
            body: {
              cancel: () => {
                cancelled = true;
                return Promise.resolve();
              },
            },
            json: () => new Promise(() => {}),
          } as unknown as Response),
        40,
      ),
    );
    expectTimeout(outcome);
    expect(cancelled).toBe(true);
  });

  test("a non-OK preview invalidate still throws the status without reading the body", async () => {
    let readBody = false;
    const outcome = await outcomeOf(
      invalidateCfPreviewHotPaths(
        env,
        async () =>
          ({
            ok: false,
            status: 502,
            json: () => {
              readBody = true;
              return new Promise(() => {});
            },
          }) as unknown as Response,
        40,
      ),
    );
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("CF Preview hot-path invalidate -> 502");
    expect(readBody).toBe(false);
  });
});

describe("Vercel discovery helpers", () => {
  test("keeps identity-origin and check-run modes", () => {
    expect(selectDiscoveryMode("  https://pre.gitstarclub.com  ")).toEqual({
      kind: "identity-origin",
      origin: "https://pre.gitstarclub.com",
    });
    expect(selectDiscoveryMode("")).toEqual({ kind: "check-run" });
  });

  test("extracts a Vercel preview host and rejects non-vercel.app deployment URLs", () => {
    expect(
      extractVercelPreviewHost(
        "💬 [Go to feedback](https://vercel.live/open-feedback/gitstarclubcom-git-loop-issue-9-zkscio.vercel.app?via=pr-comment-feedback-link)",
      ),
    ).toBe("gitstarclubcom-git-loop-issue-9-zkscio.vercel.app");
    expect(validateVercelDeploymentUrl("https://example.vercel.app/")).toBe("https://example.vercel.app");
    expect(() => validateVercelDeploymentUrl("https://gitstarclub-web.worldgo.workers.dev/")).toThrow(
      "Rejected unexpected Vercel deployment URL",
    );
  });
});
