import { beforeEach, describe, expect, test } from "bun:test";
import { resetBucketIdentityCacheForTests } from "@/lib/runtime-config";
import { DualReadObjectStore } from "./dual-read-store";
import {
  createR2S3ObjectStore,
  createReadObjectStore,
  createWriteObjectStore,
  describeStorageDrivers,
  getReadObjectStore,
  getWriteObjectStore,
  r2StoreConfigFromEnv,
} from "./object-store";
import { R2S3ObjectStore } from "./r2-s3-store";
import { createVercelBlobFetchClient } from "./vercel-blob-fetch-client";
import { VercelBlobObjectStore } from "./vercel-blob-store";

const r2Credentials = {
  R2_ACCESS_KEY_ID: "id",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "gitstarclub-pre",
  R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
};

beforeEach(() => {
  resetBucketIdentityCacheForTests();
});

describe("object store factory", () => {
  test("defaults both drivers to Vercel Blob and does not need an R2 token", () => {
    expect(describeStorageDrivers({})).toEqual({ read: "blob", write: "blob" });
    expect(createWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(createReadObjectStore({ STORAGE_READ_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
  });

  test("HOSTING_TARGET=cf blob writes go through runtime fetch, not Node TLS", async () => {
    const calls: RequestInit[] = [];
    const client = createVercelBlobFetchClient({
      fetch: async (_input, init = {}) => {
        calls.push(init);
        return new Response(JSON.stringify({ etag: '"cf1"', url: "https://blob.example.com/ops/a.json" }), { status: 200 });
      },
    });
    const store = new VercelBlobObjectStore(() => "vercel_blob_rw_cdv7ejjwmzbbdj8w_testsecret", client);
    expect(createWriteObjectStore({ HOSTING_TARGET: "cf", STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(await store.put("ops/a.json", "{}", { allowOverwrite: true })).toEqual({
      etag: '"cf1"',
      url: "https://blob.example.com/ops/a.json",
    });
    expect(calls[0]).not.toHaveProperty("ALPNProtocols");
    expect(JSON.stringify(calls[0])).not.toContain("ALPN");
  });

  test("refuses a Cloudflare R2 write driver when DEPLOY_ENV is unset without talking to a bucket", () => {
    expect(() =>
      createWriteObjectStore({
        STORAGE_WRITE_DRIVER: "r2",
        HOSTING_TARGET: "cf",
        ...r2Credentials,
      }),
    ).toThrow("unset on Cloudflare");
  });

  test("builds an r2_then_blob read store from env aliases", () => {
    const store = createReadObjectStore({
      READ_DRIVER: "r2_then_blob",
      AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_S3_BUCKET: "gitstarclub-assets",
      R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
    });
    expect(store).toBeInstanceOf(DualReadObjectStore);
  });

  test("getReadObjectStore and getWriteObjectStore match the factory", () => {
    expect(getReadObjectStore({ STORAGE_READ_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
    expect(getWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob" })).toBeInstanceOf(VercelBlobObjectStore);
  });

  test("createReadObjectStore can build a pure R2 reader", () => {
    const store = createReadObjectStore({
      STORAGE_READ_DRIVER: "r2",
      R2_ACCESS_KEY_ID: "id",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "gitstarclub-assets",
      R2_ACCOUNT_ID: "00f850e853e4c7f9627233d51a6e30a1",
    });
    expect(store).toBeInstanceOf(R2S3ObjectStore);
  });

  test("R2 config fails closed without credentials", () => {
    expect(() => r2StoreConfigFromEnv({})).toThrow("R2 driver requires");
  });

  test("R2 reads do not consult the bucket identity marker", async () => {
    const store = createR2S3ObjectStore(r2Credentials, {
      fetch: async (input, init) => {
        const method = init?.method ?? "GET";
        const url = String(input);
        if (method === "GET" && url.includes("/views/a.json")) {
          return new Response("{}", { status: 200, headers: { etag: '"a"' } });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    });
    expect((await store.get("views/a.json"))?.body).toBe("{}");
  });

  test("R2 write config defaults to an empty prefix", () => {
    const config = r2StoreConfigFromEnv(r2Credentials);
    expect(config.prefix).toBe("");
    const store = createWriteObjectStore({
      WRITE_DRIVER: "r2",
      DEPLOY_ENV: "pre",
      ...r2Credentials,
    });
    expect(store).toBeInstanceOf(R2S3ObjectStore);
  });

  test("Blob writes stay on the Blob driver when DEPLOY_ENV is unset", () => {
    expect(createWriteObjectStore({ STORAGE_WRITE_DRIVER: "blob", HOSTING_TARGET: "cf" })).toBeInstanceOf(
      VercelBlobObjectStore,
    );
  });
});

describe("bucket identity write guard", () => {
  function guardedStore(handler: (method: string, url: string) => Response) {
    const calls: string[] = [];
    const store = createR2S3ObjectStore(
      { DEPLOY_ENV: "pre", R2_PREFIX: "migrate-dev/", ...r2Credentials },
      {
        fetch: async (input, init) => {
          const url = String(input);
          const method = init?.method ?? "GET";
          calls.push(`${method} ${url}`);
          return handler(method, url);
        },
      },
    );
    return { store, calls };
  }

  test("DEPLOY_ENV=pre refuses a write when the marker says production", async () => {
    const { store, calls } = guardedStore((_method, url) => {
      if (url.includes("/_meta/bucket-identity.json")) {
        return new Response(JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "production" }), { status: 200 });
      }
      return new Response(null, { status: 500 });
    });
    await expect(store.put("views/a.json", "{}")).rejects.toThrow(
      "deploy_env=production does not match DEPLOY_ENV=pre",
    );
    expect(calls.some((call) => call.startsWith("PUT"))).toBe(false);
    expect(calls[0]).toContain("/_meta/bucket-identity.json");
    expect(calls[0]).not.toContain("migrate-dev/_meta");
  });

  test("a missing or unreadable marker refuses the write", async () => {
    const missing = guardedStore(() => new Response(null, { status: 404 }));
    await expect(missing.store.put("views/a.json", "{}")).rejects.toThrow("marker is missing");

    resetBucketIdentityCacheForTests();
    const broken = guardedStore(() => new Response("nope", { status: 500 }));
    await expect(broken.store.del("views/a.json")).rejects.toThrow("marker is unreadable");
    expect(broken.calls.some((call) => call.startsWith("DELETE"))).toBe(false);
  });

  test("a matching marker is cached and the following put does not re-read it", async () => {
    let identityReads = 0;
    const { store } = guardedStore((method, url) => {
      if (url.includes("/_meta/bucket-identity.json")) {
        identityReads += 1;
        return new Response(JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "pre" }), {
          status: 200,
          headers: { etag: '"id"' },
        });
      }
      if (method === "PUT") return new Response(null, { status: 200, headers: { etag: '"1"' } });
      return new Response(null, { status: 500 });
    });
    await store.put("views/a.json", "{}");
    await store.put("views/b.json", "{}");
    expect(identityReads).toBe(1);
  });

  test("refuses put and del of any key under _meta/ without reading the marker", async () => {
    const { store, calls } = guardedStore(() => {
      throw new Error("should not fetch");
    });
    await expect(store.put("_meta/x", "{}")).rejects.toThrow("keys under _meta/");
    await expect(store.del("_meta/bucket-identity.json")).rejects.toThrow("keys under _meta/");
    await expect(store.del(["views/a.json", "_meta/x"])).rejects.toThrow("keys under _meta/");
    expect(calls).toEqual([]);
  });

  test("refuses dot segments that would collapse into _meta/ through URL normalization", async () => {
    const { store, calls } = guardedStore(() => {
      throw new Error("should not fetch");
    });
    await expect(store.put("views/../_meta/x", "{}")).rejects.toThrow('"." or ".."');
    await expect(store.put("views/%2e%2e/_meta/x", "{}")).rejects.toThrow('"." or ".."');
    await expect(store.del("views/./../_meta/x")).rejects.toThrow('"." or ".."');
    expect(calls).toEqual([]);
  });

  test("refuses a physical key under _meta/ when the prefix is the meta namespace", async () => {
    const store = createR2S3ObjectStore(
      { DEPLOY_ENV: "pre", ...r2Credentials },
      {
        prefix: "_meta/",
        fetch: async () => {
          throw new Error("should not fetch");
        },
      },
    );
    await expect(store.put("x", "{}")).rejects.toThrow("keys under _meta/");
  });

  test("identity cache follows the store endpoint after extras, not the env endpoint", async () => {
    let reads = 0;
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/_meta/bucket-identity.json")) {
        reads += 1;
        return new Response(JSON.stringify({ bucket: "gitstarclub-pre", deploy_env: "pre" }), { status: 200 });
      }
      if (method === "PUT") return new Response(null, { status: 200, headers: { etag: '"1"' } });
      return new Response(null, { status: 500 });
    };
    const env = { DEPLOY_ENV: "pre", R2_S3_ENDPOINT: "https://from-env.example", ...r2Credentials };
    const first = createR2S3ObjectStore(env, { endpoint: "https://override-a.example", fetch: fetchImpl });
    const second = createR2S3ObjectStore(env, { endpoint: "https://override-b.example", fetch: fetchImpl });
    await first.put("views/a.json", "{}");
    await second.put("views/b.json", "{}");
    expect(reads).toBe(2);
  });
});
