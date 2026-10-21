import { expect, test } from "bun:test";
import { fetchWithTimeout, withPublishedReaders } from "../../src/lib/published-readers";
import type { pageData } from "../../src/lib/data";
import { publicationScope } from "../../../web/lib/workers-host/publication-fence";
import { workerBindings } from "../../../web/lib/workers-host/runtime-env";

type Data = ReturnType<typeof pageData>;
function data(id: string, read: (key: string) => Promise<unknown | null>): Data {
  return {
    publication: { id, views: null, bootstrap: null, live: null },
    base: async () => { throw new Error("Only the existing reader selects base paths"); },
    raw: async (key, schema) => { const value = await read(key); return value === null ? null : schema.parse(value); },
  };
}
const origin = (id: string) => `https://${id}.astro-data.invalid`;

test("published reader transport isolates simultaneous request bindings and publication", async () => {
  const previousFetch = globalThis.fetch;
  const values = await Promise.all(["one", "two"].map((id) => withPublishedReaders(data(id, async (key) => {
    await Bun.sleep(id === "one" ? 5 : 1);
    return { id, key };
  }), async () => {
    expect(publicationScope.getStore()?.id).toBe(id);
    expect(workerBindings().BLOB_BASE_URL).toBe(origin(id));
    const response = await fetchWithTimeout(`${origin(id)}/views/v1/meta.json?v=ignored`);
    return response.json();
  })));
  expect(values).toEqual([{ id: "one", key: "views/v1/meta.json" }, { id: "two", key: "views/v1/meta.json" }]);
  expect(globalThis.fetch).toBe(previousFetch);
  expect(publicationScope.getStore()).toBeUndefined();
  expect(workerBindings().BLOB_BASE_URL).toBeUndefined();
});

test("only confirmed missing objects become 404; native storage errors propagate", async () => {
  await withPublishedReaders(data("missing", async () => null), async () => {
    expect((await fetchWithTimeout(`${origin("missing")}/meta.json`)).status).toBe(404);
  });
  await withPublishedReaders(data("failure", async () => { throw new Error("storage unavailable"); }), async () => {
    await expect(fetchWithTimeout(`${origin("failure")}/meta.json`)).rejects.toThrow("storage unavailable");
  });
});

test("published transport refuses writes and invalid object paths", async () => {
  await withPublishedReaders(data("readonly", async () => { throw new Error("must not read"); }), async () => {
    await expect(fetchWithTimeout(`${origin("readonly")}/meta.json`, { method: "POST" })).rejects.toThrow("read-only");
    await expect(fetchWithTimeout(new Request(`${origin("readonly")}/meta.json`, { method: "DELETE" }))).rejects.toThrow("read-only");
    await expect(fetchWithTimeout(`${origin("readonly")}/%2E%2E%2Fmeta.json`)).rejects.toThrow("Invalid published DATA key");
  });
});

test("published transport retains caller cancellation and timeout behavior", async () => {
  await withPublishedReaders(data("abort", async () => { await Bun.sleep(30); return {}; }), async () => {
    const controller = new AbortController(); controller.abort(new Error("caller cancelled"));
    await expect(fetchWithTimeout(`${origin("abort")}/meta.json`, { signal: controller.signal })).rejects.toThrow("caller cancelled");
    await expect(fetchWithTimeout(`${origin("abort")}/meta.json`, { timeoutMs: 1 })).rejects.toThrow("fetch timed out");
  });
});

test("requests outside the native scope retain the original explicit fetcher", async () => {
  const response = await fetchWithTimeout("https://example.invalid", { fetcher: async () => new Response("original") });
  expect(await response.text()).toBe("original");
});
