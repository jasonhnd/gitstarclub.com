import { expect, test } from "bun:test";
import { fetchWithTimeout, withPublishedReaders } from "../src/lib/published-readers";
import type { pageData } from "../src/lib/data";
import { runWithCloudflareWorkersHostForTests as withCloudflareReadPolicy } from "../../web/lib/runtime-config";
import { rankPeriodLookbackLimits } from "../../web/lib/data/rank-periods";

const data: ReturnType<typeof pageData> = {
  publication: { id: "shared", views: null, bootstrap: null, live: null },
  base: async () => { throw new Error("Unexpected base read"); },
  raw: async () => { throw new Error("Unexpected native read"); },
};

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
