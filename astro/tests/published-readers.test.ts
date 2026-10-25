import { expect, test } from "bun:test";
import { fetchWithTimeout, withPublishedReaders } from "../src/lib/published-readers";
import type { pageData } from "../src/lib/data";
import { pageData as nativePageData } from "../src/lib/data";
import { Meta } from "../src/lib/contracts";
import { runWithCloudflareWorkersHostForTests as withCloudflareReadPolicy } from "../../web/lib/runtime-config";

// Match the production transport alias without replacing global fetch.
const transport = new URL("../src/lib/published-readers.ts", import.meta.url).pathname;
Bun.plugin({ name: "published-reader-test", setup(build) {
  build.onResolve({ filter: /^@\/lib\/fetch-timeout\.mjs$/ }, () => ({ path: transport }));
} });
const { readAuthoritativeView } = await import("../../web/lib/data/source");
const { rankPeriodLookbackLimits } = await import("../../web/lib/data/rank-periods");

const data: ReturnType<typeof pageData> = {
  publication: { id: "shared", views: null, bootstrap: null, live: null },
  base: async () => { throw new Error("Unexpected base read"); },
  raw: async () => { throw new Error("Unexpected native read"); },
};

test("native transport preserves present JSON null for shared-reader validation", async () => {
  const bucket = { async get(key: string) {
    return key === "meta.json" ? { text: async () => "null", etag: "null-fixture" } : null;
  } } as unknown as Parameters<typeof pageData>[0];
  const captured = nativePageData(bucket, { id: "null-fixture", views: null, bootstrap: null, live: null });
  await withPublishedReaders(captured, async () => {
    const origin = "https://null-fixture.astro-data.invalid";
    const present = await fetchWithTimeout(`${origin}/meta.json`);
    expect(present.status).toBe(200);
    const value = await present.json();
    expect(value).toBeNull();
    expect(() => Meta.parse(value)).toThrow();
    const head = await fetchWithTimeout(new Request(`${origin}/meta.json`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const missing = await fetchWithTimeout(`${origin}/missing.json`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toBeNull();
  });
});

test("authoritative native reads fall back only on 404, not on present JSON null", async () => {
  const path = "canonical/v2/meta.json";
  const generation = "authoritative-null-fixture";
  const overlayKey = `bootstrap/overlays/${generation}/${path}`;
  const sealedKey = `bootstrap/generations/${generation}/${path}`;
  const sealed = { schema_ver: 1, seam_date: "2026-07-17" };
  for (const present of [false, true]) {
    const calls: string[] = [];
    const bucket = { async get(key: string) {
      calls.push(key);
      const body = key === sealedKey ? JSON.stringify(sealed) : key === overlayKey && present ? "null" : undefined;
      return body === undefined ? null : { text: async () => body, etag: key };
    } } as unknown as Parameters<typeof pageData>[0];
    const captured = nativePageData(bucket, {
      id: `${generation}-${present}`, views: null, live: null,
      bootstrap: {
        schema_ver: 1, generation, prefix: `bootstrap/generations/${generation}`,
        previous_generation: null, published_at: "2026-07-17T12:00:00.000Z",
        base_manifest_sha256: "a".repeat(64), canonical_manifest_sha256: "b".repeat(64),
      },
    });
    await withPublishedReaders(captured, async () => {
      if (present) {
        await expect(readAuthoritativeView(path, Meta)).rejects.toMatchObject({ name: "ZodError" });
      } else {
        expect(await readAuthoritativeView(path, Meta)).toEqual(sealed);
      }
    });
    expect(calls).toEqual(present ? [overlayKey] : [overlayKey, sealedKey]);
  }
});

test("P6 Cloudflare discovery policy is opt-in, async-scoped and restored for P5", async () => {
  await withCloudflareReadPolicy(false, async () => {
    expect(withPublishedReaders(data, rankPeriodLookbackLimits)).toEqual({ monthLookback: 18, weekLookback: 12 });
    const policies = await Promise.all([
      withPublishedReaders(data, async () => {
        await Bun.sleep(5);
        return rankPeriodLookbackLimits();
      }, { cloudflareReadPolicy: true }),
      withPublishedReaders(data, async () => {
        await Bun.sleep(1);
        return rankPeriodLookbackLimits();
      }),
    ]);
    expect(policies).toEqual([{ monthLookback: 1, weekLookback: 1 }, { monthLookback: 18, weekLookback: 12 }]);
    expect(rankPeriodLookbackLimits()).toEqual({ monthLookback: 18, weekLookback: 12 });
  });
});

test("external fetches strip unsupported cache options inside and outside the publication scope", async () => {
  const original = globalThis.fetch;
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push({ input, init });
    return new Response("external");
  }) as typeof fetch;
  try {
    for (const scoped of [false, true]) {
      const run = async () => {
        for (const cache of ["force-cache", "reload", "default", "only-if-cached", "no-cache", "no-store"] as const) {
          const request = new Request("https://external.invalid/view.json", { method: "HEAD" });
          const response = await fetchWithTimeout(request, { cache, headers: { "x-fixture": "shared" } });
          expect(await response.text()).toBe("external");
          const call = calls.at(-1)!;
          expect(call.input).toBe(request);
          expect(call.init?.cache).toBe(["no-cache", "no-store"].includes(cache) ? cache : undefined);
          expect(call.init?.headers).toEqual({ "x-fixture": "shared" });
          expect(call.init?.signal).toBeInstanceOf(AbortSignal);
        }
      };
      await (scoped ? withPublishedReaders(data, run) : run());
    }
    expect(calls).toHaveLength(12);
  } finally { globalThis.fetch = original; }
});

test("external passthrough keeps cancellation and timeout; an explicit fetcher remains authoritative", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) reject(init.signal.reason);
    else init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch;
  try {
    await withPublishedReaders(data, async () => {
      const controller = new AbortController();
      controller.abort(new Error("cancel external read"));
      await expect(fetchWithTimeout("https://external.invalid", { signal: controller.signal })).rejects.toThrow("cancel external read");
      await expect(fetchWithTimeout("https://external.invalid", { timeoutMs: 1 })).rejects.toThrow("fetch timed out");
      const response = await fetchWithTimeout("https://shared.astro-data.invalid/meta.json", {
        cache: "force-cache",
        fetcher: async (_input, init) => {
          expect(init?.cache).toBe("force-cache");
          return new Response("explicit fetcher");
        },
      });
      expect(await response.text()).toBe("explicit fetcher");
    });
  } finally { globalThis.fetch = original; }
});
