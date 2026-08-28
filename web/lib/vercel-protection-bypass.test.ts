import { describe, expect, test } from "bun:test";
import {
  cookieHeaderFromSetCookie,
  fetchWithVercelProtectionBypass,
  vercelProtectionBypassHeaders,
} from "./vercel-protection-bypass";

describe("vercelProtectionBypassHeaders", () => {
  test("returns nothing when the automation secret is absent", () => {
    expect(vercelProtectionBypassHeaders({})).toEqual({});
    expect(vercelProtectionBypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: "  " })).toEqual({});
  });

  test("sends the bypass header and cookie flag when the secret is set", () => {
    expect(vercelProtectionBypassHeaders({ VERCEL_AUTOMATION_BYPASS_SECRET: " tok " })).toEqual({
      "x-vercel-protection-bypass": "tok",
      "x-vercel-set-bypass-cookie": "true",
    });
  });
});

describe("cookieHeaderFromSetCookie", () => {
  test("keeps name=value pairs and drops cookie attributes", () => {
    expect(
      cookieHeaderFromSetCookie(["_vercel_jwt=abc; Path=/; HttpOnly; Secure; SameSite=Lax"]),
    ).toBe("_vercel_jwt=abc");
  });

  test("joins multiple cookies", () => {
    expect(cookieHeaderFromSetCookie(["a=1; Path=/", "b=2; Secure"])).toBe("a=1; b=2");
  });

  test("returns null when there is nothing to send", () => {
    expect(cookieHeaderFromSetCookie([])).toBeNull();
    expect(cookieHeaderFromSetCookie(["", "Secure"])).toBeNull();
  });
});

describe("fetchWithVercelProtectionBypass", () => {
  test("replays the bypass jwt cookie after a same-path 307", async () => {
    const calls: Array<{ url: string; cookie: string | null }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), cookie: headers.get("Cookie") });
      if (!headers.get("Cookie")) {
        return new Response(JSON.stringify({ redirect: "/.well-known/deployment", status: "307" }), {
          status: 307,
          headers: {
            Location: "/.well-known/deployment",
            "Set-Cookie": "_vercel_jwt=abc; Path=/; HttpOnly; Secure",
            "Content-Type": "application/json",
          },
        });
      }
      return Response.json({
        commitSha: "deadbeef",
        deploymentUrl: "https://example.vercel.app",
      });
    }) as typeof fetch;

    try {
      const response = await fetchWithVercelProtectionBypass(
        "https://preview.example/.well-known/deployment",
        { headers: { Accept: "application/json" } },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        commitSha: "deadbeef",
        deploymentUrl: "https://example.vercel.app",
      });
      expect(calls).toEqual([
        { url: "https://preview.example/.well-known/deployment", cookie: null },
        { url: "https://preview.example/.well-known/deployment", cookie: "_vercel_jwt=abc" },
      ]);
    } finally {
      globalThis.fetch = original;
    }
  });

  test("does not follow a Vercel SSO location", async () => {
    const original = globalThis.fetch;
    let hops = 0;
    globalThis.fetch = (async () => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { Location: "https://vercel.com/sso?url=https://preview.example" },
      });
    }) as typeof fetch;

    try {
      const response = await fetchWithVercelProtectionBypass("https://preview.example/");
      expect(response.status).toBe(302);
      expect(hops).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});
