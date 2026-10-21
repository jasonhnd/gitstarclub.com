import { expect, test } from "bun:test";
import { fetchWithTimeout, withPublishedData } from "../../src/lib/published-fetch";
import { withWorkerEnv, workerBindings } from "../../../web/lib/workers-host/runtime-env";
import { getPublicReadBases } from "../../../web/lib/runtime-config";
import type { R2Bucket } from "../../../web/lib/storage/r2-binding-store";

function bucket(body: string): R2Bucket {
  return {
    get: async (key) => key === "views/sample/meta.json" ? { key, size: body.length, etag: "sample", httpEtag: '"sample"', text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer } : null,
    head: async () => null,
    put: async () => { throw new Error("Unexpected write"); },
    delete: async () => { throw new Error("Unexpected delete"); },
    list: async () => { throw new Error("Unexpected list"); },
  };
}
test("published transport uses request-scoped native DATA without mutating the ambient environment", async () => {
  const original = process.env.BLOB_BASE_URL;
  const read = (value: string) => withWorkerEnv({ DATA: bucket(value), EXTRA: value }, () => withPublishedData(async () => {
    expect(workerBindings().EXTRA).toBe(value);
    expect(getPublicReadBases()).toEqual(["https://astro-data.invalid"]);
    const response = await fetchWithTimeout("https://astro-data.invalid/views/sample/meta.json?v=sample");
    expect(response.status).toBe(200); expect(response.headers.get("etag")).toBe('"sample"');
    return response.text();
  }));
  expect(await Promise.all([read("first"), read("second")])).toEqual(["first", "second"]);
  expect(process.env.BLOB_BASE_URL).toBe(original);
});
test("native transport preserves absence/HEAD and rejects writes, unsafe keys and missing binding", async () => {
  await withWorkerEnv({ DATA: bucket("{}") }, async () => {
    expect((await fetchWithTimeout("https://astro-data.invalid/missing.json")).status).toBe(404);
    expect(await (await fetchWithTimeout("https://astro-data.invalid/views/sample/meta.json", { method: "HEAD" })).text()).toBe("");
    await expect(fetchWithTimeout("https://astro-data.invalid/views/sample/meta.json", { method: "POST" })).rejects.toThrow("read-only");
    await expect(fetchWithTimeout("https://astro-data.invalid/views%2F..%2Fmeta.json")).rejects.toThrow("Invalid published object key");
  });
  await expect(withWorkerEnv({}, () => fetchWithTimeout("https://astro-data.invalid/meta.json"))).rejects.toThrow("requires DATA");
});
test("ordinary HTTP and explicit fetchers retain the original timeout contract", async () => {
  expect(await (await fetchWithTimeout("https://astro-data.invalid/meta.json", { fetcher: async () => new Response("explicit") })).text()).toBe("explicit");
  await expect(fetchWithTimeout("https://ordinary.example/meta.json", { timeoutMs: 1, fetcher: async () => new Promise(() => {}) })).rejects.toThrow("fetch timed out");
});
